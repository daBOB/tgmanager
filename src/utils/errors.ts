// Error handling shared across the CLI.
//
// Only one failure needs a class of its own: AUTH_KEY_DUPLICATED arrives in
// several shapes (our own throw, a raw API error, a plain Error whose message
// embeds the code) and needs recovery advice rather than a stack trace.
// Everything else is reported through the logger at the point it happens.
import logger from '../logger.js';
import { printError } from './console-output.js';

/** Telegram's code for "this auth key is in use somewhere else". */
const AUTH_KEY_DUPLICATED_CODE = 406;

export class AuthKeyDuplicatedError extends Error {
  code: number;
  timestamp: Date;

  constructor(message = 'Authentication key is being used from another location') {
    super(message);
    this.name = 'AuthKeyDuplicatedError';
    this.code = AUTH_KEY_DUPLICATED_CODE;
    this.timestamp = new Date();
  }
}

/**
 * Read the `code` off a thrown value, whatever it turns out to be.
 *
 * Node attaches string errno codes ('EIO', 'ENOENT') to filesystem and process
 * errors, while the Telegram client attaches numeric ones. Neither is on the
 * `Error` type, and `catch` binds `unknown`, so every call site used to reach
 * through an `any` cast. This narrows once instead.
 *
 * @returns the code, or undefined when the value carries none.
 */
export function getErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const { code } = error as { code?: unknown };
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

/**
 * Recognise an AUTH_KEY_DUPLICATED failure from any of the shapes it arrives in:
 * our own error class, a raw API error carrying code 406, or a plain Error whose
 * message embeds the code name.
 */
export function isAuthKeyDuplicatedError(error: unknown): boolean {
  if (error instanceof AuthKeyDuplicatedError) return true;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: number; message?: string };
  return (
    candidate.code === AUTH_KEY_DUPLICATED_CODE ||
    candidate.message?.includes('AUTH_KEY_DUPLICATED') === true
  );
}

/**
 * Log an AUTH_KEY_DUPLICATED failure and tell the user how to recover from it.
 *
 * Retrying cannot help while a second instance holds the same session key, so
 * the message names the steps that do: stop the other instance, wait, and as a
 * last resort drop the session.
 *
 * @param error - the value that was caught, when one is in hand; its message is
 *                logged so the originating call is identifiable afterwards.
 */
export function reportAuthKeyDuplicated(error?: unknown): void {
  logger.error('Authentication key duplicated', {
    code: AUTH_KEY_DUPLICATED_CODE,
    detail: 'The same session is being used from multiple locations',
    error: error instanceof Error ? error.message : undefined,
  });

  printError(
    '\n❌ Authentication error: The same session is being used from another location. Please:\n' +
    '1. Stop all other running instances\n' +
    '2. Wait a few minutes\n' +
    '3. Try again\n' +
    'If the problem persists, clear your session: rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT/*\n'
  );
}
