// src/queue/queue-manager.ts
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';
import type { QueueJob, QueueAddOptions } from './queue-types.js';
import { readQueue, writeQueue, getQueueDir, getQueueFilePath } from './queue-file-operations.js';
import { withQueueLock } from './queue-file-lock.js';
import {
  recoverStaleJobsInQueue,
  cleanupCompletedJobsInQueue,
  pollJobStatusUntilDone,
} from './queue-process-utils.js';

// Re-export file operation functions for convenience
export { getQueueDir, getQueueFilePath };

const MAX_QUEUE_SIZE = 1000;

/**
 * Apply a change to one job as a single locked read-modify-write cycle.
 *
 * Every mutation must re-read the queue *inside* the lock — the CLI and the
 * worker both write this file concurrently, so anything read beforehand may
 * already be out of date.
 *
 * @param account - Account identifier
 * @param jobId - Job to modify
 * @param action - Verb used in log messages when the job can't be modified
 * @param mutate - Applies the change; return false to abort without writing
 * @returns The job as modified, or null if it was missing or `mutate` declined
 */
function mutateJob(
  account: string,
  jobId: string,
  action: string,
  mutate: (job: QueueJob) => boolean
): QueueJob | null {
  return withQueueLock(account, () => {
    const queue = readQueue(account);
    const job = queue.jobs.find(j => j.id === jobId);

    if (!job) {
      logger.warn(`Cannot ${action} job - not found`, { account, jobId });
      return null;
    }

    if (!mutate(job)) return null;

    writeQueue(account, queue);
    return job;
  });
}

/** Build a pending job record with a fresh ID and timestamp. */
function buildJob(options: QueueAddOptions): QueueJob {
  return {
    id: randomUUID(),
    filePath: options.filePath,
    virtualPath: options.virtualPath,
    storageChannelId: options.storageChannelId,
    deleteSource: options.deleteSource ?? false,
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    workerPid: null,
  };
}

/**
 * Add a single job to the queue.
 * @returns Created job
 * @throws If the queue is full (MAX_QUEUE_SIZE active jobs)
 */
export function addJob(account: string, options: QueueAddOptions): QueueJob {
  const [job] = addJobs(account, [options]);
  return job!;
}

/**
 * Add several jobs in one locked read-modify-write.
 *
 * Queuing a directory one job at a time rewrites the whole queue document per
 * file, which is quadratic in the number of entries and takes the lock N times.
 *
 * @throws If the queue would exceed MAX_QUEUE_SIZE active jobs
 */
export function addJobs(account: string, optionsList: QueueAddOptions[]): QueueJob[] {
  return withQueueLock(account, () => {
    const queue = readQueue(account);

    const activeJobs = queue.jobs.filter(j => j.status === 'pending' || j.status === 'processing');
    if (activeJobs.length + optionsList.length > MAX_QUEUE_SIZE) {
      throw new Error(`Queue is full (${MAX_QUEUE_SIZE} active jobs). Wait for jobs to complete.`);
    }

    const jobs = optionsList.map(buildJob);
    queue.jobs.push(...jobs);
    writeQueue(account, queue);

    logger.info(`Added ${jobs.length} job(s) to queue`, {
      account,
      jobIds: jobs.map(j => j.id),
    });

    return jobs;
  });
}

/**
 * Get the next pending job from the queue, sorted by creation time.
 * Read-only: the returned job is a snapshot and may be claimed by another
 * process before this one gets to it, which `claimJob` detects.
 * @param account - Account identifier
 * @returns Next pending job or null if none available
 */
export function getNextPendingJob(account: string): QueueJob | null {
  const queue = readQueue(account);
  const pendingJobs = queue.jobs
    .filter(job => job.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return pendingJobs[0] || null;
}

/**
 * Claim a job for processing by setting its status and worker PID.
 * The pending check and the write happen under one lock, so exactly one worker
 * can win the claim.
 * @param account - Account identifier
 * @param jobId - Job ID to claim
 * @returns Claimed job or null if already claimed
 */
export function claimJob(account: string, jobId: string): QueueJob | null {
  const job = mutateJob(account, jobId, 'claim', j => {
    if (j.status !== 'pending') {
      logger.warn(`Cannot claim job - not pending`, { account, jobId, status: j.status });
      return false;
    }
    j.status = 'processing';
    j.workerPid = process.pid;
    j.startedAt = new Date().toISOString();
    return true;
  });

  if (job) logger.info(`Claimed job for processing`, { account, jobId, workerPid: process.pid });
  return job;
}

/**
 * Mark a job as successfully completed.
 * @param account - Account identifier
 * @param jobId - Job ID to complete
 */
export function completeJob(account: string, jobId: string): void {
  const job = mutateJob(account, jobId, 'complete', j => {
    j.status = 'completed';
    j.completedAt = new Date().toISOString();
    j.workerPid = null;
    return true;
  });

  if (job) logger.info(`Job completed`, { account, jobId });
}

/**
 * Mark a job as failed with error message.
 * @param account - Account identifier
 * @param jobId - Job ID to fail
 * @param error - Error message describing failure
 */
export function failJob(account: string, jobId: string, error: string): void {
  const job = mutateJob(account, jobId, 'fail', j => {
    j.status = 'failed';
    j.error = error;
    j.completedAt = new Date().toISOString();
    j.workerPid = null;
    return true;
  });

  if (job) logger.error(`Job failed`, { account, jobId, error });
}

/**
 * Cancel a pending job. Only works for pending jobs.
 * @param account - Account identifier
 * @param jobId - Job ID to cancel
 * @returns true if cancelled, false if job not pending or not found
 */
export function cancelJob(account: string, jobId: string): boolean {
  const job = mutateJob(account, jobId, 'cancel', j => {
    if (j.status !== 'pending') {
      logger.warn(`Cannot cancel job - not pending`, { account, jobId, status: j.status });
      return false;
    }
    j.status = 'cancelled';
    j.completedAt = new Date().toISOString();
    return true;
  });

  if (job) logger.info(`Job cancelled`, { account, jobId });
  return job !== null;
}

/**
 * Get a specific job by ID.
 * @param account - Account identifier
 * @param jobId - Job ID to retrieve
 * @returns Job or null if not found
 */
export function getJob(account: string, jobId: string): QueueJob | null {
  const queue = readQueue(account);
  return queue.jobs.find(j => j.id === jobId) || null;
}

/**
 * List all jobs for an account.
 * @param account - Account identifier
 * @returns Array of all jobs
 */
export function listJobs(account: string): QueueJob[] {
  const queue = readQueue(account);
  return queue.jobs;
}

/**
 * Get the position of a job in the pending queue (1-indexed).
 * @param account - Account identifier
 * @param jobId - Job ID to check position
 * @returns Position (1-indexed) or -1 if not found or not pending
 */
export function getQueuePosition(account: string, jobId: string): number {
  const queue = readQueue(account);
  const pendingJobs = queue.jobs
    .filter(job => job.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const position = pendingJobs.findIndex(job => job.id === jobId);
  return position === -1 ? -1 : position + 1; // Convert to 1-indexed
}

/**
 * Recover stale jobs (processing jobs with dead worker PIDs).
 * Resets them back to pending status for retry.
 * @param account - Account identifier
 * @returns Count of recovered jobs
 */
export function recoverStaleJobs(account: string): number {
  return withQueueLock(account, () => {
    const queue = readQueue(account);
    const recoveredCount = recoverStaleJobsInQueue(account, queue);

    if (recoveredCount > 0) {
      writeQueue(account, queue);
    }

    return recoveredCount;
  });
}

/**
 * Clean up old completed/failed/cancelled jobs.
 * Removes jobs older than maxAge milliseconds.
 * @param account - Account identifier
 * @param maxAge - Maximum age in milliseconds (default: 24 hours)
 * @returns Count of cleaned up jobs
 */
export function cleanupCompletedJobs(account: string, maxAge: number = 24 * 60 * 60 * 1000): number {
  return withQueueLock(account, () => {
    const queue = readQueue(account);
    const cleanedCount = cleanupCompletedJobsInQueue(account, queue, maxAge);

    if (cleanedCount > 0) {
      writeQueue(account, queue);
    }

    return cleanedCount;
  });
}

/**
 * Poll queue file until job reaches terminal state (completed/failed/cancelled).
 * Useful for waiting on job completion from a different process.
 * @param account - Account identifier
 * @param jobId - Job ID to monitor
 * @param intervalMs - Polling interval in milliseconds (default: 500ms)
 * @returns Promise resolving to true if completed, false if failed/cancelled
 */
export async function pollJobStatus(
  account: string,
  jobId: string,
  intervalMs: number = 500
): Promise<boolean> {
  return pollJobStatusUntilDone(getJob, account, jobId, intervalMs);
}
