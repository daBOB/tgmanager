// Silences the one rejection teleproto always produces while shutting down.
//
// Its update loop races the connection against a timer. Closing the socket
// makes that race reject with "TIMEOUT", and nothing is awaiting it by then, so
// the runtime reports an unhandled rejection and prints a stack trace from
// inside node_modules at the end of every otherwise successful run — which
// buries real errors in noise.
//
// The suppression is deliberately narrow: only this message, and only once
// teardown has started. A TIMEOUT during an upload is a genuine failure and
// still surfaces.
import logger from '../logger.js';

let shuttingDown = false;

/** Message teleproto's update-loop race rejects with. */
const SHUTDOWN_TIMEOUT_MESSAGE = 'TIMEOUT';

/** Mark teardown as begun, from which point the timeout rejection is expected. */
export function beginTelegramShutdown(): void {
  shuttingDown = true;
}

/** True when `reason` is the rejection teleproto emits as its connection closes. */
export function isExpectedShutdownRejection(reason: unknown): boolean {
  if (!shuttingDown) return false;
  return reason instanceof Error && reason.message === SHUTDOWN_TIMEOUT_MESSAGE;
}

/**
 * Install the process-level handler.
 *
 * Anything that is *not* the expected shutdown timeout is logged as an error
 * rather than swallowed: an unhandled rejection elsewhere is a real defect and
 * must stay visible.
 */
export function installShutdownNoiseFilter(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    if (isExpectedShutdownRejection(reason)) {
      logger.debug('Ignored expected teleproto shutdown timeout');
      return;
    }

    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

/** Reset between tests; the flag is process-wide otherwise. */
export function resetShutdownStateForTests(): void {
  shuttingDown = false;
}
