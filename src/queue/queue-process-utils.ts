// src/queue/queue-process-utils.ts
import logger from '../logger.js';
import type { QueueJob, QueueFile } from './queue-types.js';
import { isProcessAlive } from '../utils/process-liveness.js';

/**
 * Recover stale jobs (processing jobs with dead worker PIDs).
 * Modifies queue in place by resetting stale jobs to pending.
 * @param account - Account identifier (for logging)
 * @param queue - Queue data to scan for stale jobs
 * @returns Count of recovered jobs
 */
export function recoverStaleJobsInQueue(account: string, queue: QueueFile): number {
  let recoveredCount = 0;

  for (const job of queue.jobs) {
    if (job.status === 'processing' && job.workerPid !== null) {
      if (!isProcessAlive(job.workerPid)) {
        logger.warn(`Recovering stale job from dead worker`, {
          account,
          jobId: job.id,
          workerPid: job.workerPid,
        });

        job.status = 'pending';
        job.workerPid = null;
        job.startedAt = null;
        recoveredCount++;
      }
    }
  }

  if (recoveredCount > 0) {
    logger.info(`Recovered ${recoveredCount} stale jobs`, { account });
  }

  return recoveredCount;
}

/**
 * Clean up old completed/failed/cancelled jobs.
 * Modifies queue in place by removing old jobs.
 * @param account - Account identifier (for logging)
 * @param queue - Queue data to clean up
 * @param maxAge - Maximum age in milliseconds
 * @returns Count of cleaned up jobs
 */
export function cleanupCompletedJobsInQueue(
  account: string,
  queue: QueueFile,
  maxAge: number
): number {
  const now = Date.now();
  const originalCount = queue.jobs.length;

  queue.jobs = queue.jobs.filter(job => {
    // Keep pending and processing jobs
    if (job.status === 'pending' || job.status === 'processing') {
      return true;
    }

    // Remove old completed/failed/cancelled jobs
    if (job.completedAt) {
      const completedTime = new Date(job.completedAt).getTime();
      const age = now - completedTime;
      return age < maxAge;
    }

    return true;
  });

  const cleanedCount = originalCount - queue.jobs.length;

  if (cleanedCount > 0) {
    logger.info(`Cleaned up ${cleanedCount} old jobs`, { account, maxAge });
  }

  return cleanedCount;
}

const DEFAULT_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Poll queue file until job reaches terminal state (completed/failed/cancelled).
 * Useful for waiting on job completion from a different process.
 * @param getJob - Function to retrieve job by ID
 * @param account - Account identifier (for logging)
 * @param jobId - Job ID to monitor
 * @param intervalMs - Polling interval in milliseconds
 * @param timeoutMs - Maximum wait time before giving up (default: 24h)
 * @returns Promise resolving to true if completed, false if failed/cancelled/timeout
 */
export async function pollJobStatusUntilDone(
  getJob: (account: string, jobId: string) => QueueJob | null,
  account: string,
  jobId: string,
  intervalMs: number,
  timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const interval = setInterval(() => {
      // Timeout check
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        logger.warn(`Polling timed out for job`, { account, jobId, timeoutMs });
        resolve(false);
        return;
      }

      const job = getJob(account, jobId);

      if (!job) {
        clearInterval(interval);
        logger.warn(`Job not found during polling`, { account, jobId });
        resolve(false);
        return;
      }

      if (job.status === 'completed') {
        clearInterval(interval);
        resolve(true);
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        clearInterval(interval);
        resolve(false);
      }
    }, intervalMs);
  });
}
