import { Api, TelegramClient } from 'telegram';
import input from 'input';
import { existsSync, mkdirSync, statSync, rmSync, unlinkSync } from 'fs';
import { readdir } from 'fs/promises';
import pLimit from 'p-limit';
import { Uploader } from '../Uploader.js';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import config from '../config.js';
import logger from '../logger.js';
import { validateChatId, validateAccountName, validateCommand, sanitizeInput } from '../utils/validation.js';
import { createSession } from '../session-helper.js';
import { createProcessLock } from '../utils/process-lock.js';
import { AuthKeyDuplicatedError, handleError } from '../utils/errors.js';
import { handleUploadStorageQueue } from './upload-storage-queue-handler.js';
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

  (client as any).on('disconnect', (err?: Error) => {
    if (err) {
      logger.error('Client disconnected with error', { error: err.message });
      process.exit(1);
    } else {
      logger.info('Client disconnected');
    }
  });

  (client as any).on('error', (err: Error) => {
    if ((err as any).code === 406 || err.message.includes('AUTH_KEY_DUPLICATED')) {
      logger.error('AUTH_KEY_DUPLICATED detected', { error: err.message });
      const message = handleError(new AuthKeyDuplicatedError());
      console.error('\n❌ ' + message + '\n');
      process.exit(1);
    }
    logger.error('Client error', { error: err.message, code: (err as any).code });
  });

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => password || '',
      phoneCode: async () => await input.text('Please enter the code you received: '),
      onError: (err: Error) => {
        if ((err as any).code === 406 || err.message.includes('AUTH_KEY_DUPLICATED')) {
          throw new AuthKeyDuplicatedError();
        }
        logger.error('Authentication error', { error: err.message });
      },
    });
    logger.info('Successfully connected to Telegram');
    client.session.save();
    return client;
  } catch (error) {
    if ((error as any).code === 406 || (error as Error).message.includes('AUTH_KEY_DUPLICATED')) {
      throw new AuthKeyDuplicatedError();
    }
    throw error;
  }
};

// Currently unused but kept for future use
const _isPremium = async (client: TelegramClient): Promise<boolean> => {
  try {
    const result = await client.invoke(new Api.users.GetFullUser({ id: 'Me' }));
    if (!result || !result.users || result.users.length === 0) {
      logger.warn('isPremium: Invalid result from API');
      return false;
    }
    const user = result.users[0] as Api.User;
    return !!(user as Api.User).premium;
  } catch (error) {
    logger.error('Failed to check premium status', { error: (error as Error).message });
    return false;
  }
};
void _isPremium;

/** Upload a single file. Reusing the Uploader instance caches premium status across batches. */
const uploadSingleFile = async (uploader: Uploader, chatId: string, filePath: string, deleteSource?: boolean): Promise<boolean> => {
  const success = await uploader.uploadFile(chatId, filePath);
  if (success && deleteSource) {
    try {
      unlinkSync(filePath);
      logger.info(`Deleted source file: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete file`, { filePath, error: (error as Error).message });
    }
  }
  return success;
};

/** Handle `upload` command: single file or directory with concurrency limit. */
async function runUploadCommand(client: TelegramClient, chatId: string, uploadPath: string, options: CommandOptions): Promise<void> {
  if (!existsSync(uploadPath)) {
    logger.error(`Path does not exist: ${uploadPath}`);
    process.exit(1);
  }

  const stats = statSync(uploadPath);
  const uploader = new Uploader(client);

  if (stats.isDirectory()) {
    const allFiles = await readdir(uploadPath);
    const files = allFiles
      .filter((file: string) => !file.startsWith('.'))
      .map((file: string) => join(uploadPath, file));

    logger.info(`Found ${files.length} files in directory ${uploadPath}`);

    const concurrencyLimit = config.app.maxConcurrentUploads;
    const limit = pLimit(concurrencyLimit);
    logger.info(`Using concurrent uploads`, { maxConcurrent: concurrencyLimit });

    const results = await Promise.all(
      files.map((file: string) =>
        limit(async () => {
          logger.info(`Starting upload: ${basename(file)}`);
          return uploadSingleFile(uploader, chatId, file, options.deleteSource);
        })
      )
    );

    const failCount = results.filter((r) => !r).length;
    logger.info(`Upload batch complete`, { total: files.length, successful: results.filter(Boolean).length, failed: failCount, concurrency: concurrencyLimit });

    if (options.deleteSource && failCount === 0) {
      try {
        rmSync(uploadPath, { recursive: false });
        logger.info(`Deleted source directory: ${uploadPath}`);
      } catch (error) {
        logger.error(`Failed to delete directory`, { path: uploadPath, error: (error as Error).message });
      }
    } else if (options.deleteSource && failCount > 0) {
      logger.warn(`Directory not deleted due to failed uploads`, { failCount });
    }
  } else {
    const success = await uploadSingleFile(uploader, chatId, uploadPath, options.deleteSource);
    if (!success) {
      logger.error('Failed to upload file');
      process.exit(1);
    }
  }
}

/** Main dispatcher: validates options, acquires lock, routes to command handler. */
export const dispatch = async (options: CommandOptions): Promise<void> => {
  let processLock: ReturnType<typeof createProcessLock> | null = null;

  try {
    // Guard: ensure CWD is valid
    try { process.cwd(); } catch (cwdError: any) {
      if (cwdError.code === 'ENOENT') {
        logger.warn('Current working directory no longer exists, changing to home directory');
        try {
          process.chdir(homedir());
        } catch (chdirError) {
          logger.error('Failed to change to home directory', { error: (chdirError as Error).message });
          console.error('Error: Current directory no longer exists and cannot change to home directory.');
          console.error('Please run the command from a valid directory (e.g., cd ~ && ./uploader-linux ...)');
          process.exit(1);
        }
      } else { throw cwdError; }
    }

    const { command, chatId, filePath, name } = options;

    if (!options.account) {
      const available = Object.keys(config.accounts).join(', ');
      console.error(`Error: Account required. Use -a <account> or set TGMANAGER_DEFAULT_ACCOUNT env var.`);
      console.error(`Available accounts: ${available}`);
      process.exit(1);
    }
    const account = options.account;

    validateCommand(command, options);
    validateAccountName(account, Object.keys(config.accounts));

    // Queue management commands (no lock or TG client needed)
    if (command === 'queue-status') {
      const { queueStatusCommand } = await import('../commands/queue-status-command.js');
      await queueStatusCommand(account);
      process.exit(0);
    }

    if (command === 'queue-cancel' && name) {
      const { queueCancelCommand } = await import('../commands/queue-cancel-command.js');
      const success = await queueCancelCommand(account, name);
      process.exit(success ? 0 : 1);
    }

    // Resolve file path
    let uploadPath: string | undefined;
    if (filePath) {
      uploadPath = filePath.startsWith('/') ? filePath : resolve(filePath);
      if (!existsSync(config.app.uploadDir)) mkdirSync(config.app.uploadDir, { recursive: true });
    }

    // Queue upload-storage jobs BEFORE acquiring lock (worker may already hold it)
    let queuedJob: any = null;
    let queuedJobIds: string[] = [];

    if (command === 'upload-storage' && uploadPath && options.virtualPath) {
      const result = await handleUploadStorageQueue(account, uploadPath, options);
      queuedJob = result.queuedJob;
      queuedJobIds = result.queuedJobIds;
    }

    // Acquire process lock
    const lockDir = join(config.app.sessionDir, '..', 'locks');
    processLock = createProcessLock(lockDir, account);
    processLock.setupCleanup();

    if (!processLock.acquire()) {
      const hasQueuedWork = queuedJob || queuedJobIds.length > 0;
      if (command === 'upload-storage' && hasQueuedWork) {
        if (options.wait) {
          console.log('⏳ Waiting for upload to complete...\n');
          const { pollJobStatusUntilDone } = await import('../queue/queue-process-utils.js');
          const { getJob } = await import('../queue/queue-manager.js');
          const idsToWait = queuedJobIds.length > 0 ? queuedJobIds : [queuedJob.id];
          const results = await Promise.all(idsToWait.map(id => pollJobStatusUntilDone(getJob, account, id, 1000)));
          process.exit(results.every(Boolean) ? 0 : 1);
        }
        console.log('✓ Worker is active. Upload queued and will be processed.\n');
        process.exit(0);
      }
      logger.error('Failed to acquire process lock. Another instance may be running.');
      console.error('\n⚠️  Another instance is already running with this account.');
      console.error('Please wait for it to finish or stop it before starting a new one.\n');
      process.exit(1);
    }

    if (chatId) validateChatId(chatId);

    const client = await startClient(account);

    if (command === 'upload' && chatId && uploadPath) {
      await runUploadCommand(client, chatId, uploadPath, options);
      process.exit(0);

    } else if (command === 'create') {
      const sanitizedName = sanitizeInput(name || '');
      const result = await client.invoke(new Api.channels.CreateChannel({ title: sanitizedName, about: '', broadcast: true, megagroup: false }));
      if (!result || !(result as any).chats || (result as any).chats.length === 0) {
        throw new Error('Failed to create channel: no channel data returned');
      }
      const channel = (result as any).chats[0] as Api.Channel;
      const channelId = `-100${channel.id.toJSNumber()}`;
      logger.info('Channel created successfully', { channelId, name: sanitizedName });
      process.exit(0);

    } else if (command === 'upload-storage') {
      const { startWorker } = await import('../queue/queue-worker.js');
      const result = await startWorker(account, client);
      process.exit(result.failed > 0 ? 1 : 0);

    } else if (command === 'download-storage' && options.virtualPath) {
      const { downloadStorageCommand } = await import('../commands/download-storage-command.js');
      const success = await downloadStorageCommand(client, { virtualPath: options.virtualPath, outputPath: options.outputPath, storageChannelId: options.storageChannel, force: options.force });
      process.exit(success ? 0 : 1);

    } else if (command === 'list-storage') {
      const { listStorageCommand } = await import('../commands/list-storage-command.js');
      const success = await listStorageCommand(client, { pathPrefix: options.virtualPath, storageChannelId: options.storageChannel });
      process.exit(success ? 0 : 1);
    }
  } catch (error) {
    if (error instanceof AuthKeyDuplicatedError || (error as any).code === 406 || (error as Error).message.includes('AUTH_KEY_DUPLICATED')) {
      const authError = error instanceof AuthKeyDuplicatedError ? error : new AuthKeyDuplicatedError();
      const message = handleError(authError);
      console.error('\n❌ ' + message + '\n');
      process.exit(1);
    }
    logger.error('Fatal error', { error: (error as Error).message, stack: (error as Error).stack });
    process.exit(1);
  } finally {
    if (processLock) processLock.release();
  }
};
