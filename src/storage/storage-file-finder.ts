// List and find stored files in the Telegram storage channel by iterating manifest messages.
import type { TelegramClient } from '../types/index.js';
import type { FileManifest } from './manifest-manager.js';
import { parseManifestFromMessage } from './storage-file-downloader.js';

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

/**
 * List all stored files by iterating channel messages and filtering for manifests.
 * Uses direct message iteration instead of Telegram search API, which can be
 * unreliable for small/new channels where the search index hasn't been built.
 */
export async function listStoredFiles(
  client: TelegramClient,
  channelId: string
): Promise<StoredFileInfo[]> {
  const files: StoredFileInfo[] = [];

  const messages = await client.getMessages(channelId, { limit: 100 });

  for (const message of messages) {
    if (!message.message?.includes('#manifest')) continue;

    const manifest = await parseManifestFromMessage(client, message);
    if (manifest) {
      // Build full virtual path: originalPath is the directory prefix (e.g. "Video/VR"),
      // originalName is the filename. Join them to get the full path for lookup.
      const dir = manifest.originalPath.replace(/\/+$/, '');
      const fullPath = dir ? `${dir}/${manifest.originalName}` : manifest.originalName;

      files.push({
        fileId: manifest.fileId,
        originalName: manifest.originalName,
        virtualPath: fullPath,
        size: manifest.originalSize,
        originalHash: manifest.originalHash,
        status: manifest.status,
        createdAt: manifest.createdAt,
        manifestMessageId: message.id
      });
    }
  }

  return files;
}

/** List files whose virtualPath starts with the given prefix */
export async function listByPath(
  client: TelegramClient,
  channelId: string,
  pathPrefix: string
): Promise<StoredFileInfo[]> {
  const all = await listStoredFiles(client, channelId);
  return all.filter(f => f.virtualPath.startsWith(pathPrefix));
}

/** Find file by exact virtualPath, returns null if not found */
export async function findByPath(
  client: TelegramClient,
  channelId: string,
  virtualPath: string
): Promise<StoredFileInfo | null> {
  const all = await listStoredFiles(client, channelId);
  return all.find(f => f.virtualPath === virtualPath) ?? null;
}

/** Find file by SHA-256 content hash, returns first match or null */
export async function findByHash(
  client: TelegramClient,
  channelId: string,
  hash: string
): Promise<StoredFileInfo | null> {
  const all = await listStoredFiles(client, channelId);
  return all.find(f => f.originalHash === hash) ?? null;
}
