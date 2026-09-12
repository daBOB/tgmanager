import { existsSync, statSync } from 'node:fs';
import { posix, basename } from 'node:path';
import logger from '../logger.js';
import { walkDirectory } from '../utils/directory-walker.js';
import { startClient } from './command-dispatcher.js';
import { print, printError } from '../utils/console-output.js';
import type { CommandOptions } from '../types/index.js';
import type { StoredFileInfo } from '../storage/storage-service.js';
import type { QueueAddOptions } from '../queue/queue-types.js';

/**
 * Outcome of the pre-lock queuing step.
 * `done` means there is nothing further to do and the CLI should exit with the
 * given code — either everything was already in storage, or the input was bad.
 */
export type QueueOutcome =
  | { kind: 'queued'; jobIds: string[] }
  | { kind: 'done'; exitCode: number };

/**
 * Fetch existing files from storage for duplicate detection.
 * Returns empty array on error (dedup skipped with warning).
 */
async function fetchExistingFiles(
  account: string,
  storageChannelId?: string
): Promise<StoredFileInfo[]> {
  try {
    const dedupClient = await startClient(account);
    const { StorageService } = await import('../storage/storage-service.js');
    const storageService = new StorageService(dedupClient, { storageChannelId });
    await storageService.initializeStorageChannel();
    const files = await storageService.listStoredFiles();
    await dedupClient.disconnect();
    return files;
  } catch (err) {
    logger.warn('Failed to check for duplicates, proceeding without dedup', {
      error: (err as Error).message,
    });
    return [];
  }
}

/** Queue directory entries as individual upload jobs. Returns null if empty. */
async function queueDirectory(
  account: string,
  uploadPath: string,
  options: CommandOptions,
  existingFiles: StoredFileInfo[]
): Promise<{ jobIds: string[]; skippedCount: number } | null> {
  const entries = await walkDirectory(uploadPath);
  if (entries.length === 0) {
    printError(`❌ No files found in directory: ${basename(uploadPath)}`);
    return null;
  }

  const dirName = basename(uploadPath);
  // Set lookup: the linear scan was O(entries x storedFiles).
  const storedPaths = new Set(existingFiles.map(f => f.virtualPath));
  const toQueue: QueueAddOptions[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    const fileVirtualPath = posix.join(options.virtualPath!, dirName, entry.relativePath);
    if (storedPaths.has(fileVirtualPath)) {
      skippedCount++;
      continue;
    }
    toQueue.push({
      filePath: entry.absolutePath,
      virtualPath: fileVirtualPath,
      storageChannelId: options.storageChannel,
      deleteSource: options.deleteSource,
      priority: options.priority,
      scheduledAt: parseScheduledAt(options.at),
    });
  }

  // One locked read-modify-write for the whole directory.
  const { addJobs } = await import('../queue/queue-manager.js');
  const jobs = toQueue.length > 0 ? addJobs(account, toQueue) : [];
  return { jobIds: jobs.map(j => j.id), skippedCount };
}

/**
 * Normalise `--at` into the ISO form the queue stores.
 *
 * Rejecting an unparseable value outright would fail an upload over a typo in
 * an optional flag; scheduling is dropped and the job runs immediately instead,
 * which is the behaviour without the flag at all.
 */
function parseScheduledAt(at: string | undefined): string | null {
  if (!at) return null;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) {
    printError(`Ignoring --at "${at}": not a recognisable date, queueing immediately`);
    return null;
  }
  return when.toISOString();
}

/**
 * Handle upload-storage pre-lock queuing.
 * Validates path, checks duplicates, enqueues job(s).
 */
export async function handleUploadStorageQueue(
  account: string,
  uploadPath: string,
  options: CommandOptions
): Promise<QueueOutcome> {
  if (!existsSync(uploadPath)) {
    logger.error(`File not found: ${uploadPath}`);
    printError(`❌ File not found: ${uploadPath}`);
    return { kind: 'done', exitCode: 1 };
  }

  const existingFiles = options.force ? [] : await fetchExistingFiles(account, options.storageChannel);
  const { addJob, getQueuePosition } = await import('../queue/queue-manager.js');

  if (statSync(uploadPath).isDirectory()) {
    const queued = await queueDirectory(account, uploadPath, options, existingFiles);
    if (!queued) return { kind: 'done', exitCode: 1 };

    const { jobIds, skippedCount } = queued;
    const dirName = basename(uploadPath);

    if (jobIds.length > 0) print(`\n✓ Queued ${jobIds.length} files from '${dirName}' for upload`);
    if (skippedCount > 0) print(`⏭  Skipped ${skippedCount} file(s) already in storage`);
    if (jobIds.length === 0 && skippedCount > 0) {
      print(`\nAll ${skippedCount} files already in storage. Nothing to queue.`);
      return { kind: 'done', exitCode: 0 };
    }

    logger.info('Directory queued', { dir: dirName, queued: jobIds.length, skipped: skippedCount });
    return { kind: 'queued', jobIds };
  }

  // Single file — check path duplicate
  if (existingFiles.length > 0 && existingFiles.some(f => f.virtualPath === options.virtualPath)) {
    print(`⏭  Skipped: "${options.virtualPath}" already exists in storage. Use --force to re-upload.`);
    return { kind: 'done', exitCode: 0 };
  }

  const queuedJob = addJob(account, {
    filePath: uploadPath,
    virtualPath: options.virtualPath!,
    storageChannelId: options.storageChannel,
    deleteSource: options.deleteSource,
    priority: options.priority,
    scheduledAt: parseScheduledAt(options.at),
  });
  const position = getQueuePosition(account, queuedJob.id);
  print(`\n✓ Added to upload queue (position: ${position})`);
  logger.info('Job added to queue', { jobId: queuedJob.id, position });
  return { kind: 'queued', jobIds: [queuedJob.id] };
}
