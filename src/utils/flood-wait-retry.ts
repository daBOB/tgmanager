// Single implementation of Telegram flood-wait (error 420) retry handling.
//
// Previously uploads retried in two places with diverging limits and downloads
// had no handling at all, so a flood wait part-way through a large restore
// aborted the whole file.
import logger from '../logger.js';
import { sleep } from './sleep.js';

/** Telegram's rate-limit error code. */
const FLOOD_WAIT_CODE = 420;

/** Fallback when the server does not say how long to wait. */
const DEFAULT_WAIT_SECONDS = 60;

const DEFAULT_MAX_RETRIES = 10;

/**
 * Safety factor applied to the server's stated wait when the caller doesn't
 * supply one. Callers with access to configuration pass
 * `config.telegram.floodWaitMultiplier` instead.
 */
export const DEFAULT_FLOOD_WAIT_MULTIPLIER = 1.5;

export interface FloodWaitOptions {
  /** Attempts after the first before giving up. Defaults to 10. */
  maxRetries?: number;
  /** Safety factor applied to the server's wait. Defaults to 1.5. */
  multiplier?: number;
  /** Called before sleeping — use it to pause progress output. */
  onWait?: (waitSeconds: number, attempt: number) => void;
  /** Called after sleeping, before the next attempt. */
  onResume?: () => void;
  /** Extra fields to include in log entries (chunk index, file id, ...). */
  context?: Record<string, unknown>;
}

/** A Telegram flood-wait error carries the seconds to wait. */
function asFloodWait(error: unknown): { seconds: number } | null {
  const candidate = error as { code?: number; seconds?: number } | null;
  if (!candidate || candidate.code !== FLOOD_WAIT_CODE) return null;
  return { seconds: candidate.seconds ?? DEFAULT_WAIT_SECONDS };
}

/**
 * Run `fn`, retrying whenever Telegram answers with a flood wait.
 * Any other error propagates immediately.
 */
export async function withFloodWaitRetry<T>(
  fn: () => Promise<T>,
  options: FloodWaitOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    multiplier = DEFAULT_FLOOD_WAIT_MULTIPLIER,
    onWait,
    onResume,
    context = {},
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const floodWait = asFloodWait(error);
      if (!floodWait) throw error;

      if (attempt >= maxRetries) {
        logger.error('Max flood wait retries exceeded', { ...context, attempt });
        throw new Error(`Max flood wait retries exceeded (${maxRetries})`, { cause: error });
      }

      const waitSeconds = Math.max(1, Math.ceil(floodWait.seconds * multiplier));
      logger.warn(`Flood wait, retrying in ${waitSeconds}s`, {
        ...context,
        originalWait: floodWait.seconds,
        actualWait: waitSeconds,
        attempt,
      });

      onWait?.(waitSeconds, attempt);
      await sleep(waitSeconds * 1000);
      onResume?.();
    }
  }
}
