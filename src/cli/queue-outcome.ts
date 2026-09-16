// What the pre-lock queuing step hands back, shared by the storage and channel
// enqueue paths so both report the same thing to the CLI and to the user.
import { existsSync } from 'node:fs';
import logger from '../logger.js';
import { printError } from '../utils/console-output.js';

/**
 * Outcome of the pre-lock queuing step.
 * `done` means there is nothing further to do and the CLI should exit with the
 * given code — either everything was already queued, or the input was bad.
 */
export type QueueOutcome =
  | { kind: 'queued'; jobIds: string[] }
  | { kind: 'done'; exitCode: number };

/**
 * Report an upload path that is not there.
 *
 * Both enqueue paths start with this check and owe the same message; sharing it
 * keeps a typo'd path reading identically whichever command was run.
 *
 * @returns true once the failure has been reported, false when the path exists.
 */
export function reportMissingUploadPath(uploadPath: string): boolean {
  if (existsSync(uploadPath)) return false;

  logger.error(`File not found: ${uploadPath}`);
  printError(`❌ File not found: ${uploadPath}`);
  return true;
}
