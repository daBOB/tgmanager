import { describe, it, expect, vi } from 'vitest';
import { withFloodWaitRetry } from '../../src/utils/flood-wait-retry.js';

/**
 * Builds an error shaped like the ones the Telegram client throws: a numeric
 * `code`, plus `seconds` on flood waits.
 */
function telegramError(code: number, message: string, seconds?: number): Error {
  return Object.assign(new Error(message), { code, seconds });
}

/** Resolves on the Nth call, failing with `error` every time before that. */
function failsThenSucceeds(failures: number, error: Error): () => Promise<string> {
  let calls = 0;
  return () => {
    calls++;
    return calls <= failures ? Promise.reject(error) : Promise.resolve('ok');
  };
}

// Retries are driven to completion without real waiting; the delay policy is
// asserted separately via onWait rather than by sleeping through it.
const FAST = { transientBackoffMs: 1, multiplier: 0 } as const;

describe('withFloodWaitRetry', () => {
  describe('transient server errors', () => {
    it('retries a 500 RPC_CALL_FAIL and succeeds', async () => {
      const fn = failsThenSucceeds(2, telegramError(500, 'RPC_CALL_FAIL (caused by upload.SaveBigFilePart)'));

      await expect(withFloodWaitRetry(fn, FAST)).resolves.toBe('ok');
    });

    it('retries any 5xx, not just 500', async () => {
      const fn = failsThenSucceeds(1, telegramError(503, 'SERVICE_UNAVAILABLE'));

      await expect(withFloodWaitRetry(fn, FAST)).resolves.toBe('ok');
    });

    it('gives up once maxRetries transient failures have occurred', async () => {
      const err = telegramError(500, 'RPC_CALL_FAIL');
      const fn = vi.fn(() => Promise.reject(err));

      await expect(withFloodWaitRetry(fn, { ...FAST, maxRetries: 3 })).rejects.toThrow(/retries exceeded/i);
      expect(fn).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
    });

    it('backs off exponentially between transient retries', async () => {
      const waits: number[] = [];
      const fn = failsThenSucceeds(3, telegramError(500, 'RPC_CALL_FAIL'));

      await withFloodWaitRetry(fn, {
        transientBackoffMs: 1,
        onWait: (seconds) => waits.push(seconds),
      });

      // Each successive wait must be at least as long as the one before it.
      expect(waits).toHaveLength(3);
      for (let i = 1; i < waits.length; i++) {
        expect(waits[i]!).toBeGreaterThanOrEqual(waits[i - 1]!);
      }
    });
  });

  describe('client errors', () => {
    it('does not retry a 400 and propagates it unchanged', async () => {
      const err = telegramError(400, 'PHOTO_SAVE_FILE_INVALID (caused by messages.SendMedia)');
      const fn = vi.fn(() => Promise.reject(err));

      await expect(withFloodWaitRetry(fn, FAST)).rejects.toThrow('PHOTO_SAVE_FILE_INVALID (caused by messages.SendMedia)');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry an error carrying no code', async () => {
      const fn = vi.fn(() => Promise.reject(new Error('boom')));

      await expect(withFloodWaitRetry(fn, FAST)).rejects.toThrow('boom');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('flood waits (regression guard)', () => {
    it('still retries a 420 flood wait', async () => {
      const fn = failsThenSucceeds(1, telegramError(420, 'FLOOD_WAIT_1', 1));

      await expect(withFloodWaitRetry(fn, { multiplier: 0 })).resolves.toBe('ok');
    });

    it('reports the flood wait duration through onWait', async () => {
      const waits: number[] = [];
      const fn = failsThenSucceeds(1, telegramError(420, 'FLOOD_WAIT_10', 10));

      await withFloodWaitRetry(fn, { multiplier: 0, onWait: (s) => waits.push(s) });

      // Floor of one second applies even when the multiplier rounds it away.
      expect(waits).toEqual([1]);
    });
  });
});
