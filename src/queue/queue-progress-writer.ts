// Persists upload progress for the job a worker is running.
//
// The progress callback fires many times a second on a large transfer; writing
// each tick would put thousands of pointless updates on disk for one file. Only
// meaningful movement is recorded, which is all another process can display.
import { updateJobProgress } from './queue-manager.js';

/** Smallest change worth a write. Finer detail is invisible in a status line. */
const MIN_PERCENT_STEP = 2;

/** Floor between writes, so a fast small file cannot burst through the step. */
const MIN_INTERVAL_MS = 1000;

export interface ProgressWriter {
  /** Report progress for the current job; most calls are discarded. */
  report(percent: number): void;
  /** Begin reporting for a new job, discarding the previous job's state. */
  startJob(jobId: string): void;
}

/**
 * Build a writer bound to one account.
 *
 * @param write - injected for tests; defaults to the real database update
 */
export function createProgressWriter(
  account: string,
  write: (account: string, jobId: string, percent: number) => void = updateJobProgress,
  now: () => number = Date.now
): ProgressWriter {
  let currentJobId: string | null = null;
  // Claiming a job stores 0, so that is the baseline the first report is
  // measured against — starting lower would let a 1% tick look like movement.
  let lastPercent = 0;
  let lastWriteAt = 0;

  return {
    startJob(jobId: string): void {
      currentJobId = jobId;
      lastPercent = 0;
      lastWriteAt = 0;
    },

    report(percent: number): void {
      if (currentJobId === null) return;

      const movedEnough = percent >= lastPercent + MIN_PERCENT_STEP;
      const waitedEnough = now() - lastWriteAt >= MIN_INTERVAL_MS;
      // 100 always lands: the last write is the one that shows a file finishing.
      if (percent < 100 && !(movedEnough && waitedEnough)) return;
      if (percent === lastPercent) return;

      lastPercent = percent;
      lastWriteAt = now();
      write(account, currentJobId, percent);
    },
  };
}
