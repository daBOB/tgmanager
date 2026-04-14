import cliProgress from 'cli-progress';
import logger from '../logger.js';
import config from '../config.js';

/** Max number of flood-wait retries before giving up */
const MAX_FLOOD_WAIT_RETRIES = 10;

/**
 * Wraps a Telegram sendFile call with flood-wait (error code 420) retry logic.
 * Pauses the progress bar during wait and resumes after.
 *
 * @param fn - async factory returning the sendFile promise; called with each attempt
 * @param progressBar - cli-progress bar to pause/resume during wait
 */
export async function withFloodWaitRetry(
  fn: () => Promise<void>,
  progressBar: cliProgress.SingleBar
): Promise<void> {
  let retryCount = 0;

  const attempt = async (): Promise<void> => {
    try {
      await fn();
    } catch (error: any) {
      if (error.code === 420) { // FloodWaitError
        if (retryCount >= MAX_FLOOD_WAIT_RETRIES) {
          logger.error('Max flood wait retries exceeded', { retryCount });
          throw new Error('Max flood wait retries exceeded');
        }

        // Fallback for undefined seconds; apply configured multiplier
        const waitSeconds = error.seconds ?? 60;
        const waitWithBuffer = Math.max(1, Math.ceil(waitSeconds * config.telegram.floodWaitMultiplier));
        logger.warn(`Flood wait error. Waiting ${waitWithBuffer} seconds before retry`, {
          originalWait: waitSeconds,
          actualWait: waitWithBuffer,
          retryCount
        });

        progressBar.stop();
        await new Promise(resolve => setTimeout(resolve, waitWithBuffer * 1000));
        progressBar.start(100, 0);

        retryCount++;
        return attempt();
      }
      throw error;
    }
  };

  return attempt();
}
