// Waiting on a queue job from a process that is not the one running it.
//
// Stale-job recovery and cleanup used to live here too, operating on a whole
// in-memory queue; both are single statements against the database now and sit
// in queue-manager.
import logger from '../logger.js';
import type { QueueJob } from './queue-types.js';

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
