// Single implementation of retry handling for transient Telegram failures.
//
// Two kinds are retried, because both are temporary and the request succeeds on
// a later attempt:
//   - flood waits (420), where the server states how long to back off;
//   - server-side errors (5xx), where it does not. RPC_CALL_FAIL during
//     upload.SaveBigFilePart is the common one; abandoning the transfer on the
//     first of these fails a whole multi-part upload over a blip, and can
//     strand already-uploaded parts so the final send reports FILE_PART_MISSING.
//
// Everything else — 4xx in particular — is a genuine rejection that will fail
// identically on retry, so it propagates untouched.
import logger from '../logger.js';
import { sleep } from './sleep.js';
import { getErrorCode } from './errors.js';

/** Telegram's rate-limit error code. */
const FLOOD_WAIT_CODE = 420;

/** Fallback when the server does not say how long to wait. */
const DEFAULT_WAIT_SECONDS = 60;

const DEFAULT_MAX_RETRIES = 10;

/** First backoff step for a transient server error; doubles per attempt. */
const DEFAULT_TRANSIENT_BACKOFF_MS = 1000;

/** Ceiling for the doubling, so a long outage does not push waits into hours. */
const MAX_TRANSIENT_BACKOFF_MS = 30_000;

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
  /** First backoff step for transient server errors, in ms. Defaults to 1000. */
  transientBackoffMs?: number;
}

/** A Telegram flood-wait error carries the seconds to wait. */
function asFloodWait(error: unknown): { seconds: number } | null {
  const candidate = error as { code?: number; seconds?: number } | null;
  if (!candidate || candidate.code !== FLOOD_WAIT_CODE) return null;
  return { seconds: candidate.seconds ?? DEFAULT_WAIT_SECONDS };
}

/**
 * A 5xx means Telegram failed to serve a well-formed request, so the same
 * request is worth repeating. A 4xx means it rejected the request itself and
 * would reject it again identically.
 *
 * The magnitude is what matters, not the sign: gramjs reports its own transport
 * failures with negative codes, and -503 (a request timeout, typically
 * mid-transfer on upload.SaveBigFilePart) is every bit as retryable as a server
 * 503. Negative 4xx codes stay non-retryable for the same reason positive ones do.
 */
function isTransientServerError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (typeof code !== 'number') return false;

  const magnitude = Math.abs(code);
  return magnitude >= 500 && magnitude < 600;
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
    transientBackoffMs = DEFAULT_TRANSIENT_BACKOFF_MS,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const floodWait = asFloodWait(error);
      const transient = floodWait === null && isTransientServerError(error);
      if (!floodWait && !transient) throw error;

      if (attempt >= maxRetries) {
        const kind = floodWait ? 'flood wait' : 'transient error';
        logger.error(`Max ${kind} retries exceeded`, { ...context, attempt });
        throw new Error(`Max ${kind} retries exceeded (${maxRetries})`, { cause: error });
      }

      let waitSeconds: number;
      if (floodWait) {
        // The server states the wait; the multiplier is a safety factor on top.
        waitSeconds = Math.max(1, Math.ceil(floodWait.seconds * multiplier));
        logger.warn(`Flood wait, retrying in ${waitSeconds}s`, {
          ...context,
          originalWait: floodWait.seconds,
          actualWait: waitSeconds,
          attempt,
        });
      } else {
        // No stated wait, so back off exponentially and let the server recover.
        waitSeconds = Math.min(transientBackoffMs * 2 ** attempt, MAX_TRANSIENT_BACKOFF_MS) / 1000;
        logger.warn(`Transient Telegram error, retrying in ${waitSeconds}s`, {
          ...context,
          code: getErrorCode(error),
          error: (error as Error).message,
          attempt,
        });
      }

      onWait?.(waitSeconds, attempt);
      await sleep(waitSeconds * 1000);
      onResume?.();
    }
  }
}
