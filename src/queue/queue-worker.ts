// src/queue/queue-worker.ts
import { basename } from 'node:path';
import { unlinkSync } from 'node:fs';
import type { TelegramClient } from '../types/index.js';
import { uploadStorageCommand } from '../commands/upload-storage-command.js';
import { StorageService } from '../storage/storage-service.js';
import { Uploader } from '../Uploader.js';
import type { QueueJob } from './queue-types.js';
import {
  getNextPendingJob,
  claimJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  countJobsByStatus
} from './queue-manager.js';
import logger from '../logger.js';
import { print } from '../utils/console-output.js';

/**
 * Run one queued job against whichever destination it names.
 *
 * The two kinds share nothing but the file on disk: a storage job is chunked,
 * manifested and deduplicated into the managed channel, while a channel job is
 * a single send to an arbitrary chat. Dispatching on `kind` keeps that split in
 * one place instead of spread through the drain loop.
 */
async function runJob(
  job: QueueJob,
  client: TelegramClient,
  uploader: Uploader,
  storageFor: (storageChannelId?: string) => Promise<StorageService>
): Promise<boolean> {
  if (job.kind === 'channel') {
    if (!job.chatId) {
      logger.error('Channel job has no chat id', { jobId: job.id });
      return false;
    }
    return uploader.uploadFile(job.chatId, job.filePath);
  }

  if (!job.virtualPath) {
    logger.error('Storage job has no virtual path', { jobId: job.id });
    return false;
  }

  return uploadStorageCommand(
    client,
    {
      filePath: job.filePath,
      virtualPath: job.virtualPath,
      storageChannelId: job.storageChannelId,
    },
    await storageFor(job.storageChannelId)
  );
}

/**
 * Start queue worker: recover stale jobs, drain queue FIFO, exit when empty.
 * The calling CLI process holds the process lock — this function reuses the
 * existing TelegramClient connection across all queued uploads.
 * @param account - Account identifier
 * @param client - Telegram client connection
 * @returns Object with count of processed and failed jobs
 */
export async function startWorker(
  account: string,
  client: TelegramClient
): Promise<{ processed: number; failed: number }> {
  // Recover any jobs left in "processing" from a crashed worker
  const recovered = recoverStaleJobs(account);
  if (recovered > 0) {
    print(`Recovered ${recovered} stale job(s) from previous run`);
  }

  let processed = 0;
  let failed = 0;

  // One storage service for the whole drain: its channel index is cached, so
  // the history is walked once rather than once per job. Jobs that name a
  // different storage channel fall back to their own service.
  // One Uploader for the whole drain: it caches the account's premium status,
  // which would otherwise cost an API round-trip per file.
  const uploader = new Uploader(client);

  const sharedStorage = new Map<string, StorageService>();
  const storageFor = async (storageChannelId?: string): Promise<StorageService> => {
    const key = storageChannelId ?? '';
    let storage = sharedStorage.get(key);
    if (!storage) {
      storage = new StorageService(client, { storageChannelId });
      await storage.initializeStorageChannel();
      sharedStorage.set(key, storage);
    }
    return storage;
  };

  // Drain queue FIFO
  while (true) {
    const nextJob = getNextPendingJob(account);
    if (!nextJob) break;

    const job = claimJob(account, nextJob.id);
    if (!job) continue; // Race condition: another process claimed it

    const pending = countJobsByStatus(account).pending ?? 0;
    print(`\n--- Queue: processing "${basename(job.filePath)}" (${pending} remaining) ---\n`);

    try {
      const success = await runJob(job, client, uploader, storageFor);

      if (success) {
        completeJob(account, job.id);
        processed++;
        logger.info('Queue job completed', { jobId: job.id, file: basename(job.filePath) });

        // Delete source file if requested
        if (job.deleteSource) {
          try {
            unlinkSync(job.filePath);
            logger.info('Deleted source file', { filePath: job.filePath });
          } catch (err) {
            logger.error('Failed to delete source file', { filePath: job.filePath, error: (err as Error).message });
          }
        }
      } else {
        failJob(account, job.id, 'Upload returned false');
        failed++;
        logger.warn('Queue job failed', { jobId: job.id, file: basename(job.filePath) });
      }
    } catch (error) {
      failJob(account, job.id, (error as Error).message);
      failed++;
      logger.error('Queue job error', { jobId: job.id, error: (error as Error).message });
    }
  }

  if (processed > 0 || failed > 0) {
    print(`\nQueue complete: ${processed} succeeded, ${failed} failed`);
  }

  return { processed, failed };
}
