import { existsSync, statSync } from 'fs';
import { posix, basename } from 'path';
import logger from '../logger.js';
import { walkDirectory } from '../utils/directory-walker.js';
import { startClient } from './command-dispatcher.js';
import type { CommandOptions } from '../types/index.js';

export interface QueueResult {
  queuedJob: any | null;
  queuedJobIds: string[];
}

/**
 * Fetch existing files from storage for duplicate detection.
 * Returns empty array on error (dedup skipped with warning).
 */
async function fetchExistingFiles(account: string, storageChannelId?: string): Promise<import('../storage/storage-service.js').StoredFileInfo[]> {
  try {
    const dedupClient = await startClient(account);
    const { StorageService } = await import('../storage/storage-service.js');
    const storageService = new StorageService(dedupClient, { storageChannelId });
    await storageService.initializeStorageChannel();
    const files = await storageService.listStoredFiles();
    await dedupClient.disconnect();
    return files;
  } catch (err) {
    logger.warn('Failed to check for duplicates, proceeding without dedup', { error: (err as Error).message });
    return [];
  }
}

/** Queue directory entries as individual upload jobs. Returns job IDs queued. */
async function queueDirectory(
  account: string,
  uploadPath: string,
  options: CommandOptions,
  existingFiles: import('../storage/storage-service.js').StoredFileInfo[],
  addJob: Function
): Promise<{ jobIds: string[]; skippedCount: number }> {
  const entries = await walkDirectory(uploadPath);
  if (entries.length === 0) {
    console.error(`❌ No files found in directory: ${basename(uploadPath)}`);
    process.exit(1);
  }

  const dirName = basename(uploadPath);
  const jobIds: string[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    const fileVirtualPath = posix.join(options.virtualPath!, dirName, entry.relativePath.split('/').join('/'));
    if (existingFiles.length > 0 && existingFiles.some(f => f.virtualPath === fileVirtualPath)) {
      skippedCount++;
      continue;
    }
    const job = addJob(account, {
      filePath: entry.absolutePath,
      virtualPath: fileVirtualPath,
      storageChannelId: options.storageChannel,
      deleteSource: options.deleteSource,
    });
    jobIds.push(job.id);
  }

  return { jobIds, skippedCount };
}

/**
 * Handle upload-storage pre-lock queuing.
 * Validates path, checks duplicates, enqueues job(s). Returns queued job refs.
 */
export async function handleUploadStorageQueue(
  account: string,
  uploadPath: string,
  options: CommandOptions
): Promise<QueueResult> {
  if (!existsSync(uploadPath)) {
    logger.error(`File not found: ${uploadPath}`);
    console.error(`❌ File not found: ${uploadPath}`);
    process.exit(1);
  }

  const existingFiles = options.force ? [] : await fetchExistingFiles(account, options.storageChannel);
  const { addJob, getQueuePosition } = await import('../queue/queue-manager.js');

  if (statSync(uploadPath).isDirectory()) {
    const { jobIds, skippedCount } = await queueDirectory(account, uploadPath, options, existingFiles, addJob);
    const dirName = basename(uploadPath);

    if (jobIds.length > 0) console.log(`\n✓ Queued ${jobIds.length} files from '${dirName}' for upload`);
    if (skippedCount > 0) console.log(`⏭  Skipped ${skippedCount} file(s) already in storage`);
    if (jobIds.length === 0 && skippedCount > 0) {
      console.log(`\nAll ${skippedCount} files already in storage. Nothing to queue.`);
      process.exit(0);
    }
    logger.info('Directory queued', { dir: dirName, queued: jobIds.length, skipped: skippedCount });
    return { queuedJob: null, queuedJobIds: jobIds };
  }

  // Single file — check path duplicate
  if (existingFiles.length > 0 && existingFiles.some(f => f.virtualPath === options.virtualPath)) {
    console.log(`⏭  Skipped: "${options.virtualPath}" already exists in storage. Use --force to re-upload.`);
    process.exit(0);
  }

  const queuedJob = addJob(account, {
    filePath: uploadPath,
    virtualPath: options.virtualPath!,
    storageChannelId: options.storageChannel,
    deleteSource: options.deleteSource
  });
  const position = getQueuePosition(account, queuedJob.id);
  console.log(`\n✓ Added to upload queue (position: ${position})`);
  logger.info('Job added to queue', { jobId: queuedJob.id, position });
  return { queuedJob, queuedJobIds: [] };
}
