// List and find stored files in the Telegram storage channel by iterating manifest messages.
import type { TelegramClient } from '../types/index.js';
import type { FileManifest } from './manifest-manager.js';
import { parseManifestFromMessage } from './storage-file-downloader.js';
import pLimit from 'p-limit';
import logger from '../logger.js';

export interface StoredFileInfo {
  fileId: string;
  originalName: string;
  virtualPath: string;
  size: number;
  originalHash: string;
  status: FileManifest['status'];
  createdAt: string;
  manifestMessageId: number;
}

/** Messages fetched per request while walking the channel history. */
const PAGE_SIZE = 100;

/**
 * Hard stop on how many messages a single walk will read.
 * Chunk uploads share the channel with manifests, so history grows fast; this
 * bounds worst-case API usage rather than the result set. Raise it only
 * alongside a real index (e.g. a pinned catalogue message).
 */
const MAX_MESSAGES_SCANNED = 100_000;

/**
 * Concurrent manifest parses within a page. Manifests that exceeded Telegram's
 * message limit are stored as attachments, so parsing one costs a download;
 * doing those serially across the whole history dominates the walk.
 */
const MANIFEST_PARSE_CONCURRENCY = 8;

/**
 * Build the full virtual path for a manifest.
 * `originalPath` is the directory prefix (e.g. "Video/VR") and `originalName`
 * the filename; lookups are done against the two joined.
 */
function toStoredFileInfo(manifest: FileManifest, messageId: number): StoredFileInfo {
  const dir = manifest.originalPath.replace(/\/+$/, '');
  return {
    fileId: manifest.fileId,
    originalName: manifest.originalName,
    virtualPath: dir ? `${dir}/${manifest.originalName}` : manifest.originalName,
    size: manifest.originalSize,
    originalHash: manifest.originalHash,
    status: manifest.status,
    createdAt: manifest.createdAt,
    manifestMessageId: messageId,
  };
}

/**
 * List all stored files by walking the channel's message history.
 *
 * Paginates with `offsetId` until the history is exhausted: a single page would
 * only reveal the most recent uploads, silently hiding every older file from
 * path lookups, hash dedup and `list-storage`.
 *
 * Uses direct message iteration instead of the Telegram search API, which can
 * be unreliable for small/new channels where the search index isn't built yet.
 */
async function listStoredFiles(
  client: TelegramClient,
  channelId: string
): Promise<StoredFileInfo[]> {
  const files: StoredFileInfo[] = [];
  let offsetId: number | undefined;
  let scanned = 0;

  for (;;) {
    const page = await client.getMessages(channelId, {
      limit: PAGE_SIZE,
      ...(offsetId === undefined ? {} : { offsetId }),
    });

    if (page.length === 0) break;

    scanned += page.length;

    // Parse this page's manifests concurrently, then append in page order so
    // the overall result stays newest-first.
    const manifestMessages = page.filter(m => m.message?.includes('#manifest'));
    const limit = pLimit(MANIFEST_PARSE_CONCURRENCY);
    const parsed = await Promise.all(
      manifestMessages.map(message =>
        limit(async () => {
          const manifest = await parseManifestFromMessage(client, message);
          return manifest ? toStoredFileInfo(manifest, message.id) : null;
        })
      )
    );
    for (const entry of parsed) {
      if (entry) files.push(entry);
    }

    // `offsetId` is exclusive and walks backwards through history.
    const oldest = page[page.length - 1];
    if (!oldest) break;
    offsetId = oldest.id;

    if (page.length < PAGE_SIZE) break;

    if (scanned >= MAX_MESSAGES_SCANNED) {
      logger.warn('Stopped scanning storage channel at safety limit', {
        scanned,
        found: files.length,
      });
      break;
    }
  }

  logger.debug('Storage channel scan complete', { scanned, manifests: files.length });
  return files;
}

/**
 * Caches one full channel walk for the lifetime of the passed-in object.
 *
 * A batch upload calls findByHash once per file; without this each call would
 * re-download the entire channel history. The cache is deliberately per-call-site
 * (not module-global) so a long-lived process can't serve stale results.
 */
export class StorageIndex {
  private cached: Promise<StoredFileInfo[]> | null = null;
  /** Files added since the walk, newest first. Kept separate so appending is O(1). */
  private appended: StoredFileInfo[] = [];

  constructor(
    private readonly client: TelegramClient,
    private readonly channelId: string
  ) {}

  /** All stored files, newest first, fetched once and reused. */
  async all(): Promise<StoredFileInfo[]> {
    const walked = await this.walked();
    return this.appended.length === 0 ? walked : [...this.appended, ...walked];
  }

  /** The cached channel walk, started at most once. */
  private walked(): Promise<StoredFileInfo[]> {
    return (this.cached ??= listStoredFiles(this.client, this.channelId));
  }

  /** Drop the cache so the next read re-walks the channel. */
  invalidate(): void {
    this.cached = null;
    this.appended = [];
  }

  /** Record a newly uploaded file without paying for a full re-walk. */
  add(manifest: FileManifest, manifestMessageId: number): void {
    if (!this.cached) return;
    this.appended.unshift(toStoredFileInfo(manifest, manifestMessageId));
  }

  async listByPath(pathPrefix: string): Promise<StoredFileInfo[]> {
    const match = (f: StoredFileInfo): boolean => f.virtualPath.startsWith(pathPrefix);
    const walked = await this.walked();
    return this.appended.length === 0
      ? walked.filter(match)
      : [...this.appended.filter(match), ...walked.filter(match)];
  }

  async findByPath(virtualPath: string): Promise<StoredFileInfo | null> {
    return this.find(f => f.virtualPath === virtualPath);
  }

  async findByHash(hash: string): Promise<StoredFileInfo | null> {
    return this.find(f => f.originalHash === hash);
  }

  /**
   * Search appended-then-walked in place. A queue drain appends after every
   * job, so building the combined list on each dedup lookup would cost
   * O(jobs x history) copying over a drain.
   */
  private async find(predicate: (f: StoredFileInfo) => boolean): Promise<StoredFileInfo | null> {
    const fresh = this.appended.find(predicate);
    if (fresh) return fresh;
    return (await this.walked()).find(predicate) ?? null;
  }
}
