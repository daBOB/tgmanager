// src/queue/queue-manager.ts
import { randomUUID } from 'crypto';
import logger from '../logger.js';
import type { QueueJob, QueueAddOptions } from './queue-types.js';
import { readQueue, writeQueue, getQueueDir, getQueueFilePath } from './queue-file-operations.js';
import {
  recoverStaleJobsInQueue,
  cleanupCompletedJobsInQueue,
  pollJobStatusUntilDone,
} from './queue-process-utils.js';

// Re-export file operation functions for convenience
export { getQueueDir, getQueueFilePath };

const MAX_QUEUE_SIZE = 1000;

/**
 * Add a new job to the queue.
 * Creates job with unique ID, pending status, and current timestamp.
 * @param account - Account identifier
 * @param options - Job configuration options
 * @returns Created job
 * @throws If queue is full (MAX_QUEUE_SIZE reached)
 */
export function addJob(account: string, options: QueueAddOptions): QueueJob {
  const queue = readQueue(account);

  const activeJobs = queue.jobs.filter(j => j.status === 'pending' || j.status === 'processing');
  if (activeJobs.length >= MAX_QUEUE_SIZE) {
    throw new Error(`Queue is full (${MAX_QUEUE_SIZE} active jobs). Wait for jobs to complete.`);
  }

  const now = new Date().toISOString();

  const job: QueueJob = {
    id: randomUUID(),
    filePath: options.filePath,
    virtualPath: options.virtualPath,
    storageChannelId: options.storageChannelId,
    deleteSource: options.deleteSource ?? false,
    status: 'pending',
    createdAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    workerPid: null,
  };

  queue.jobs.push(job);
  writeQueue(account, queue);

  logger.info(`Added job to queue`, {
    account,
    jobId: job.id,
    filePath: options.filePath,
    virtualPath: options.virtualPath,
  });

  return job;
}

/**
 * Get the next pending job from the queue, sorted by creation time.
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
 * Returns null if job is already claimed or doesn't exist.
 * @param account - Account identifier
 * @param jobId - Job ID to claim
 * @returns Claimed job or null if already claimed
 */
export function claimJob(account: string, jobId: string): QueueJob | null {
  const queue = readQueue(account);
  const job = queue.jobs.find(j => j.id === jobId);

  if (!job) {
    logger.warn(`Cannot claim job - not found`, { account, jobId });
    return null;
  }

  if (job.status !== 'pending') {
    logger.warn(`Cannot claim job - not pending`, { account, jobId, status: job.status });
    return null;
  }

  // Claim the job
  job.status = 'processing';
  job.workerPid = process.pid;
  job.startedAt = new Date().toISOString();

  writeQueue(account, queue);

  logger.info(`Claimed job for processing`, {
    account,
    jobId,
    workerPid: process.pid,
  });

  return job;
}

/**
 * Mark a job as successfully completed.
 * @param account - Account identifier
 * @param jobId - Job ID to complete
 */
export function completeJob(account: string, jobId: string): void {
  const queue = readQueue(account);
  const job = queue.jobs.find(j => j.id === jobId);

  if (!job) {
    logger.warn(`Cannot complete job - not found`, { account, jobId });
    return;
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.workerPid = null;

  writeQueue(account, queue);

  logger.info(`Job completed`, { account, jobId });
}

/**
 * Mark a job as failed with error message.
 * @param account - Account identifier
 * @param jobId - Job ID to fail
 * @param error - Error message describing failure
 */
export function failJob(account: string, jobId: string, error: string): void {
  const queue = readQueue(account);
  const job = queue.jobs.find(j => j.id === jobId);

  if (!job) {
    logger.warn(`Cannot fail job - not found`, { account, jobId });
    return;
  }

  job.status = 'failed';
  job.error = error;
  job.completedAt = new Date().toISOString();
  job.workerPid = null;

  writeQueue(account, queue);

  logger.error(`Job failed`, { account, jobId, error });
}

/**
 * Cancel a pending job. Only works for pending jobs.
 * @param account - Account identifier
 * @param jobId - Job ID to cancel
 * @returns true if cancelled, false if job not pending or not found
 */
export function cancelJob(account: string, jobId: string): boolean {
  const queue = readQueue(account);
  const job = queue.jobs.find(j => j.id === jobId);

  if (!job) {
    logger.warn(`Cannot cancel job - not found`, { account, jobId });
    return false;
  }

  if (job.status !== 'pending') {
    logger.warn(`Cannot cancel job - not pending`, { account, jobId, status: job.status });
    return false;
  }

  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();

  writeQueue(account, queue);

  logger.info(`Job cancelled`, { account, jobId });
  return true;
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
  const queue = readQueue(account);
  const recoveredCount = recoverStaleJobsInQueue(account, queue);

  if (recoveredCount > 0) {
    writeQueue(account, queue);
  }

  return recoveredCount;
}

/**
 * Clean up old completed/failed/cancelled jobs.
 * Removes jobs older than maxAge milliseconds.
 * @param account - Account identifier
 * @param maxAge - Maximum age in milliseconds (default: 24 hours)
 * @returns Count of cleaned up jobs
 */
export function cleanupCompletedJobs(account: string, maxAge: number = 24 * 60 * 60 * 1000): number {
  const queue = readQueue(account);
  const cleanedCount = cleanupCompletedJobsInQueue(account, queue, maxAge);

  if (cleanedCount > 0) {
    writeQueue(account, queue);
  }

  return cleanedCount;
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
