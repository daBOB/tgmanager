// Returns the job a worker is holding when the process is asked to stop.
//
// Without this, a SIGTERM mid-upload leaves the row in `processing` with a pid
// that no longer exists: the queue only learns the truth on the next run, which
// recovers it as stale and reports a warning about work nobody is doing.
import { releaseJob } from './queue-manager.js';
import logger from '../logger.js';

/** The job id the worker currently holds, or null between jobs. */
export interface InFlightJob {
  jobId: string | null;
}

/**
 * Release `inFlight` back to the queue when a stop signal arrives.
 *
 * Registered with `prependListener`, not `on`: the process lock installs its
 * own handlers for these signals and calls `process.exit` inside them, so a
 * listener added afterwards would never run. For the same reason the release
 * is synchronous — nothing queued behind the exit call survives it.
 *
 * @returns a function that removes the handlers again, for when the worker
 *          finishes normally and the process goes on to do something else.
 */
export function releaseInFlightJobOnShutdown(account: string, inFlight: InFlightJob): () => void {
  const release = (): void => {
    const { jobId } = inFlight;
    if (!jobId) return;

    if (releaseJob(account, jobId)) {
      logger.info('Returned in-flight job to the queue', { account, jobId });
    }
  };

  process.prependListener('SIGINT', release);
  process.prependListener('SIGTERM', release);

  return () => {
    process.removeListener('SIGINT', release);
    process.removeListener('SIGTERM', release);
  };
}
