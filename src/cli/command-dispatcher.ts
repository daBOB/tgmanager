import { TelegramClient } from 'telegram';
import type { EventEmitter } from 'node:events';
import { promptText } from '../utils/prompt-input.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import config from '../config.js';
import logger from '../logger.js';
import { validateChatId, validateAccountName, validateCommand } from '../utils/validation.js';
import { createSession } from '../session-helper.js';
import { createProcessLock } from '../utils/process-lock.js';
import { AuthKeyDuplicatedError, handleError, isAuthKeyDuplicatedError } from '../utils/errors.js';
import { handleUploadStorageQueue } from './upload-storage-queue-handler.js';
import { routeCommand } from './command-router.js';
import { print, printError } from '../utils/console-output.js';
import type { CommandOptions } from '../types/index.js';

/** Create and connect a Telegram client for the given account. */
export const startClient = async (account_name: string): Promise<TelegramClient> => {
  const configDir = join(config.app.sessionDir, account_name);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  logger.debug(`Session directory: ${configDir}`);
  const session = createSession(configDir);

  const accountConfig = config.accounts[account_name];
  if (!accountConfig) throw new Error(`Account '${account_name}' not found in configuration`);

  const { apiId, apiHash, phoneNumber, password } = accountConfig;

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: config.telegram.connectionRetries,
    useWSS: config.telegram.useWSS
  });

  // gramjs types `on` without the (event, handler) overload even though the
  // client emits these, so narrow to the EventEmitter surface it really has.
  const clientEvents = client as unknown as EventEmitter;

  clientEvents.on('disconnect', (err?: Error) => {
    if (err) {
      logger.error('Client disconnected with error', { error: err.message });
      process.exit(1);
    } else {
      logger.info('Client disconnected');
    }
  });

  clientEvents.on('error', (err: Error) => {
    if (isAuthKeyDuplicatedError(err)) {
      logger.error('AUTH_KEY_DUPLICATED detected', { error: err.message });
      printError('\n❌ ' + handleError(new AuthKeyDuplicatedError()) + '\n');
      process.exit(1);
    }
    logger.error('Client error', { error: err.message });
  });

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => password || '',
      phoneCode: async () => await promptText('Please enter the code you received: '),
      onError: (err: Error) => {
        if (isAuthKeyDuplicatedError(err)) throw new AuthKeyDuplicatedError();
        logger.error('Authentication error', { error: err.message });
      },
    });
    logger.info('Successfully connected to Telegram');
    client.session.save();
    return client;
  } catch (error) {
    if (isAuthKeyDuplicatedError(error)) throw new AuthKeyDuplicatedError();
    throw error;
  }
};

/**
 * Ensure the process has a usable working directory.
 * A packaged binary is often invoked from a directory that has since been
 * deleted, which makes every relative path operation fail.
 * @returns true if the CWD is usable
 */
function ensureUsableWorkingDirectory(): boolean {
  try {
    process.cwd();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    logger.warn('Current working directory no longer exists, changing to home directory');
    try {
      process.chdir(homedir());
      return true;
    } catch (chdirError) {
      logger.error('Failed to change to home directory', {
        error: (chdirError as Error).message,
      });
      printError('Error: Current directory no longer exists and cannot change to home directory.');
      printError('Please run the command from a valid directory (e.g., cd ~ && ./uploader-linux ...)');
      return false;
    }
  }
}

/** Commands that manage the queue itself: no lock and no Telegram client needed. */
async function runQueueOnlyCommand(options: CommandOptions, account: string): Promise<number | null> {
  if (options.command === 'queue-status') {
    const { queueStatusCommand } = await import('../commands/queue-status-command.js');
    await queueStatusCommand(account);
    return 0;
  }

  if (options.command === 'queue-cancel' && options.name) {
    const { queueCancelCommand } = await import('../commands/queue-cancel-command.js');
    return (await queueCancelCommand(account, options.name)) ? 0 : 1;
  }

  return null;
}

/**
 * Another instance holds the account lock. Upload work has already been queued
 * at this point, so the running worker will pick it up.
 * @returns process exit code
 */
async function reportQueuedWorkToRunningWorker(
  account: string,
  options: CommandOptions,
  jobIds: string[]
): Promise<number> {
  if (!options.wait) {
    print('✓ Worker is active. Upload queued and will be processed.\n');
    return 0;
  }

  print('⏳ Waiting for upload to complete...\n');
  const { pollJobStatus } = await import('../queue/queue-manager.js');

  const results = await Promise.all(jobIds.map(id => pollJobStatus(account, id, 1000)));
  return results.every(Boolean) ? 0 : 1;
}

/**
 * Main dispatcher: validates options, acquires the account lock, routes to the
 * command handler.
 *
 * Returns an exit code instead of calling process.exit so that the `finally`
 * block below actually runs — process.exit skips it, which previously left the
 * lock release to the process 'exit' handler alone.
 *
 * @returns process exit code
 */
export const dispatch = async (options: CommandOptions): Promise<number> => {
  let processLock: ReturnType<typeof createProcessLock> | null = null;
  let client: TelegramClient | null = null;

  try {
    if (!ensureUsableWorkingDirectory()) return 1;

    if (!options.account) {
      const available = Object.keys(config.accounts).join(', ');
      printError('Error: Account required. Use -a <account> or set TGMANAGER_DEFAULT_ACCOUNT env var.');
      printError(`Available accounts: ${available}`);
      return 1;
    }
    const account = options.account;

    validateCommand(options.command, options);
    validateAccountName(account, Object.keys(config.accounts));

    const queueOnlyResult = await runQueueOnlyCommand(options, account);
    if (queueOnlyResult !== null) return queueOnlyResult;

    // Resolve the source path
    let uploadPath: string | undefined;
    if (options.filePath) {
      uploadPath = options.filePath.startsWith('/') ? options.filePath : resolve(options.filePath);
      if (!existsSync(config.app.uploadDir)) mkdirSync(config.app.uploadDir, { recursive: true });
    }

    // Queue upload-storage jobs BEFORE acquiring the lock: a worker may already
    // hold it, in which case it will drain what we just enqueued.
    let queuedJobIds: string[] = [];

    if (options.command === 'upload-storage' && uploadPath && options.virtualPath) {
      const outcome = await handleUploadStorageQueue(account, uploadPath, options);
      if (outcome.kind === 'done') return outcome.exitCode;
      queuedJobIds = outcome.jobIds;
    }

    const lockDir = join(config.app.sessionDir, '..', 'locks');
    processLock = createProcessLock(lockDir, account);
    processLock.setupCleanup();

    if (!processLock.acquire()) {
      if (options.command === 'upload-storage' && queuedJobIds.length > 0) {
        return reportQueuedWorkToRunningWorker(account, options, queuedJobIds);
      }

      logger.error('Failed to acquire process lock. Another instance may be running.');
      printError('\n⚠️  Another instance is already running with this account.');
      printError('Please wait for it to finish or stop it before starting a new one.\n');
      return 1;
    }

    if (options.chatId) validateChatId(options.chatId);

    client = await startClient(account);
    return await routeCommand({ client, account, options, uploadPath });
  } catch (error) {
    if (isAuthKeyDuplicatedError(error)) {
      const authError = error instanceof AuthKeyDuplicatedError ? error : new AuthKeyDuplicatedError();
      printError('\n❌ ' + handleError(authError) + '\n');
      return 1;
    }
    logger.error('Fatal error', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return 1;
  } finally {
    // gramjs keeps sockets and ping timers open; without this the process would
    // never exit now that handlers return instead of calling process.exit.
    if (client) {
      try {
        await client.disconnect();
      } catch (error) {
        logger.debug('Client disconnect failed', { error: (error as Error).message });
      }
    }
    if (processLock) processLock.release();
  }
};
