import type cliProgress from 'cli-progress';
import { withFloodWaitRetry } from '../utils/flood-wait-retry.js';
import config from '../config.js';

/**
 * Wraps a Telegram sendFile call with flood-wait retry logic, pausing the
 * progress bar for the duration of the wait so it doesn't sit there implying
 * the transfer is still moving.
 *
 * The retry policy itself lives in utils/flood-wait-retry.ts and is shared with
 * the storage upload and download paths.
 *
 * @param fn - async factory returning the sendFile promise; called per attempt
 * @param progressBar - cli-progress bar to pause/resume during the wait
 */
export async function withFloodWaitRetryAndProgress(
  fn: () => Promise<void>,
  progressBar: cliProgress.SingleBar
): Promise<void> {
  await withFloodWaitRetry(fn, {
    multiplier: config.telegram.floodWaitMultiplier,
    onWait: () => progressBar.stop(),
    onResume: () => progressBar.start(100, 0),
  });
}
