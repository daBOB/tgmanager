// Cross-process mutual exclusion for the account queue file.
//
// Individual writes are already atomic (temp file + rename), but a job state
// change is a read-modify-write cycle, and two processes legitimately run at
// once: the CLI enqueues jobs *before* taking the account lock, precisely
// because a worker may already hold it. Interleaved cycles silently lose an
// update — a queued job disappears, or a claim is overwritten.
//
// The lock is an O_EXCL lockfile holding the owner's PID, so a crashed holder
// can be detected and cleared rather than wedging the queue forever.
import { openSync, closeSync, writeSync, unlinkSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import logger from '../logger.js';
import { getQueueDir, getQueueFilePath } from './queue-file-operations.js';
import { isProcessAlive } from '../utils/process-liveness.js';

/** Give up waiting after this long; a queue mutation is only a few ms of work. */
const ACQUIRE_TIMEOUT_MS = 5_000;

/** Delay between acquisition attempts. */
const RETRY_INTERVAL_MS = 25;

/** A lock held longer than this by a live PID is treated as abandoned. */
const STALE_LOCK_MS = 30_000;

/**
 * Block the thread without spinning the CPU.
 * The wait buffer is allocated once: a contended acquire polls every 25ms and
 * would otherwise allocate a SharedArrayBuffer per slice.
 */
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(waitBuffer, 0, 0, ms);
}

/** Remove a lock whose owner died, or which has simply been held far too long. */
function clearIfStale(lockPath: string): void {
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);

    const ownerGone = Number.isFinite(pid) && !isProcessAlive(pid);
    if (ownerGone || age > STALE_LOCK_MS) {
      unlinkSync(lockPath);
      logger.warn('Cleared stale queue lock', { lockPath, pid, ageMs: Math.round(age) });
    }
  } catch {
    // Lock vanished or is unreadable — the next acquire attempt settles it.
  }
}

/**
 * Run `fn` while holding the account's queue lock.
 * Re-read the queue inside the callback: anything read beforehand may be stale.
 */
export function withQueueLock<T>(account: string, fn: () => T): T {
  const queueDir = getQueueDir();
  if (!existsSync(queueDir)) mkdirSync(queueDir, { recursive: true });

  const lockPath = `${getQueueFilePath(account)}.lock`;
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  let fd: number | undefined;
  for (;;) {
    try {
      // 'wx' fails if the file exists, making creation the atomic test-and-set.
      fd = openSync(lockPath, 'wx');
      writeSync(fd, process.pid.toString());
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      clearIfStale(lockPath);

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the queue lock for account '${account}' (${lockPath}). ` +
          'Another process may be stuck; remove the lock file if no worker is running.',
          { cause: error }
        );
      }
      sleepSync(RETRY_INTERVAL_MS);
    }
  }

  try {
    return fn();
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
      unlinkSync(lockPath);
    } catch (error) {
      logger.error('Failed to release queue lock', {
        lockPath,
        error: (error as Error).message,
      });
    }
  }
}
