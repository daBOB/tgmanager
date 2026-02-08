// src/queue/queue-worker.ts
import { basename } from 'path';
import { unlinkSync } from 'fs';
import type { TelegramClient } from '../types/index.js';
import { uploadStorageCommand } from '../commands/upload-storage-command.js';
import {
  getNextPendingJob,
  claimJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  cleanupCompletedJobs,
  listJobs
} from './queue-manager.js';
import logger from '../logger.js';

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
    console.log(`Recovered ${recovered} stale job(s) from previous run`);
  }

  // Cleanup old completed/failed/cancelled jobs (>24h)
  cleanupCompletedJobs(account);

  let processed = 0;
  let failed = 0;

  // Drain queue FIFO
  while (true) {
    const nextJob = getNextPendingJob(account);
    if (!nextJob) break;

    const job = claimJob(account, nextJob.id);
    if (!job) continue; // Race condition: another process claimed it

    const pending = listJobs(account).filter(j => j.status === 'pending').length;
    console.log(`\n--- Queue: processing "${basename(job.filePath)}" (${pending} remaining) ---\n`);

    try {
      const success = await uploadStorageCommand(client, {
        filePath: job.filePath,
        virtualPath: job.virtualPath,
        storageChannelId: job.storageChannelId,
        deleteSource: job.deleteSource
      });

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
    console.log(`\nQueue complete: ${processed} succeeded, ${failed} failed`);
  }

  return { processed, failed };
}

/**
 * Check if account queue has pending or processing work
 * @param account - Account identifier
 * @returns true if queue has work, false otherwise
 */
export function hasQueuedWork(account: string): boolean {
  const jobs = listJobs(account);
  return jobs.some(j => j.status === 'pending' || j.status === 'processing');
}
