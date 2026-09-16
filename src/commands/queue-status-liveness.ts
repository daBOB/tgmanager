// Renders a job's status honestly, by asking whether its worker still exists.
//
// A row's `status` column alone cannot answer "is this uploading?". A worker
// that dies mid-upload — a reboot, an OOM kill, a closed terminal — leaves the
// row saying 'processing' with its last progress value frozen in place. Printed
// straight, that reads exactly like live work, so an abandoned queue looks busy
// indefinitely.
//
// The queue already resolves this the same way elsewhere: `recoverStaleJobs`
// and `queue-retry` both treat a claim as stale when its pid is gone. This puts
// the display on that one definition of liveness rather than trusting `status`.
import type { QueueJob } from '../queue/queue-types.js';
import { isProcessAlive } from '../utils/process-liveness.js';

/** Tests whether a worker process still exists. Injected so tests need no real pids. */
type LivenessCheck = (pid: number) => boolean;

/**
 * Is this job claimed by a worker that no longer exists?
 *
 * A processing row with no recorded pid counts as stalled too: nothing can be
 * shown to be working on it, so calling it live would be the same lie.
 */
function isStalled(job: QueueJob, isAlive: LivenessCheck): boolean {
  if (job.status !== 'processing') return false;

  return job.workerPid === null || !isAlive(job.workerPid);
}

/**
 * Status text for one row of the queue listing.
 *
 * Live work shows its progress, since the row's position already says it is
 * processing. Abandoned work says so, and keeps the last progress it reached as
 * a hint of how much a retry would repeat.
 *
 * @param job - the job being rendered
 * @param isAlive - liveness test; defaults to a real process check
 */
export function describeJobStatus(job: QueueJob, isAlive: LivenessCheck = isProcessAlive): string {
  if (job.status !== 'processing') return job.status;

  if (isStalled(job, isAlive)) {
    return job.progress !== null ? `stalled ${job.progress}%` : 'stalled';
  }

  return job.progress !== null ? `${job.progress}%` : 'processing';
}

/**
 * How many listed jobs are claimed by workers that are gone.
 *
 * Drives the notice telling the operator that the queue has stopped and what
 * recovers it — the thing a frozen progress figure hides.
 */
export function countStalledJobs(jobs: QueueJob[], isAlive: LivenessCheck = isProcessAlive): number {
  return jobs.filter(job => isStalled(job, isAlive)).length;
}

/**
 * Warning printed when the listing contains abandoned claims.
 *
 * Naming the recovery command matters: a stalled queue is otherwise silent —
 * there is no error, no failed row, just work that stopped — so the operator has
 * no reason to suspect anything needs doing.
 *
 * @returns the notice, or null when nothing is stalled
 */
export function stalledNotice(stalled: number): string | null {
  if (stalled <= 0) return null;

  const subject = stalled === 1 ? '1 job is' : `${stalled} jobs are`;

  return `Warning: ${subject} stalled — claimed by a worker that is no longer running. ` +
    'No upload is in progress. Run queue-run to requeue and resume.';
}
