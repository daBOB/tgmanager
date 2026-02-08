import { Api, TelegramClient } from 'telegram';
import input from 'input';
import { existsSync, mkdirSync, statSync, rmSync, unlinkSync } from 'fs';
import { readdir } from 'fs/promises';
import { Command } from 'commander';
import pLimit from 'p-limit';
import { Uploader } from './Uploader.js';
import { join, posix, basename, resolve } from 'path';
import { homedir } from 'os';
import config from './config.js';
import logger from './logger.js';
import { validatePath, validateChatId, validateAccountName, validateCommand, sanitizeInput, resolveCommandAlias, VALID_COMMANDS } from './utils/validation.js';
import { walkDirectory } from './utils/directory-walker.js';
import { createSession } from './session-helper.js';
import { createProcessLock } from './utils/process-lock.js';
import { AuthKeyDuplicatedError, handleError } from './utils/errors.js';
import type { CommandOptions } from './types/index.js';

const startClient = async (account_name: string): Promise<TelegramClient> => {
  const configDir = join(config.app.sessionDir, account_name);
  // Ensure the config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  logger.debug(`Session directory: ${configDir}`);
  const session = createSession(configDir);
  
  // Validate account exists
  const accountConfig = config.accounts[account_name];
  if (!accountConfig) {
    throw new Error(`Account '${account_name}' not found in configuration`);
  }
  
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
    // Check for AUTH_KEY_DUPLICATED error
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
      phoneCode: async () =>
        await input.text('Please enter the code you received: '),
      onError: (err: Error) => {
        // Check for AUTH_KEY_DUPLICATED in authentication
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
    // Check if it's an AUTH_KEY_DUPLICATED error
    if ((error as any).code === 406 || (error as Error).message.includes('AUTH_KEY_DUPLICATED')) {
      throw new AuthKeyDuplicatedError();
    }
    throw error;
  }
};

// Currently unused but kept for future use
const _isPremium = async (client: TelegramClient): Promise<boolean> => {
  try {
    const result = await client.invoke(
      new Api.users.GetFullUser({
        id: 'Me',
      })
    );
    if (!result || !result.users || result.users.length === 0) {
      logger.warn('isPremium: Invalid result from API');
      return false;
    }
    const user = result.users[0] as Api.User;
    if (!user.premium) {
      logger.debug('isPremium: User does not have premium');
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Failed to check premium status', { error: (error as Error).message });
    return false;
  }
};

const program = new Command();

program
  .option('-a, --account <account>', 'Account name (or set TGMANAGER_DEFAULT_ACCOUNT)')
  .option('-c, --command <command>', 'Command to execute')
  .option('-i, --chat-id <id>', 'Chat ID')
  .option('-f, --file-path <path>', 'File path')
  .option('-n, --name <name>', 'Name')
  .option('--delete-source', 'Delete the source file after the operation')
  .option('--virtual-path <path>', 'Virtual path for storage operations')
  .option('--output-path <path>', 'Output path for download operations')
  .option('--storage-channel <id>', 'Storage channel ID (optional)')
  .option('--force', 'Force overwrite existing files')
  .option('--wait', 'Wait for queued upload to complete')
  .allowExcessArguments(true);

program.parse(process.argv);

const options = program.opts<CommandOptions>();

// Resolve account: CLI flag > TGMANAGER_DEFAULT_ACCOUNT env var > error
if (!options.account) {
  const defaultAccount = process.env.TGMANAGER_DEFAULT_ACCOUNT;
  if (defaultAccount) {
    options.account = defaultAccount;
  }
}

// Resolve command from positional args if -c not provided
const positionalArgs = program.args;
if (!options.command && positionalArgs.length > 0 && positionalArgs[0]) {
  const resolved = resolveCommandAlias(positionalArgs[0]);
  if (VALID_COMMANDS.includes(resolved)) {
    options.command = resolved;
    applyPositionalArgs(options, resolved, positionalArgs.slice(1));
  }
} else if (options.command) {
  // Resolve alias on -c flag (e.g., -c store -> upload-storage)
  options.command = resolveCommandAlias(options.command);
  // Apply remaining positional args as file/virtualPath if not set via flags
  if (positionalArgs.length > 0) {
    applyPositionalArgs(options, options.command, positionalArgs);
  }
}

/**
 * Map positional arguments to options based on the resolved command.
 * Explicit flags always take priority over positional args.
 */
function applyPositionalArgs(opts: CommandOptions, command: string, args: string[]): void {
  switch (command) {
    case 'upload-storage':
      if (!opts.filePath && args.length >= 1) opts.filePath = args[0];
      if (!opts.virtualPath && args.length >= 2) opts.virtualPath = args[1];
      break;
    case 'download-storage':
      if (!opts.virtualPath && args.length >= 1) opts.virtualPath = args[0];
      break;
    case 'list-storage':
      if (!opts.virtualPath && args.length >= 1) opts.virtualPath = args[0];
      break;
  }
}

/**
 * Upload a single file using provided Uploader instance.
 * Reusing Uploader instance allows caching of premium status across batch uploads.
 */
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

const main = async (): Promise<void> => {
  let processLock: ReturnType<typeof createProcessLock> | null = null;

  try {
    // Ensure we're in a valid directory
    try {
      process.cwd();
    } catch (cwdError: any) {
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
      } else {
        throw cwdError;
      }
    }

    const { command, chatId, filePath, deleteSource, name } = options;

    // Resolve account: error if still not set after env var fallback
    if (!options.account) {
      const available = Object.keys(config.accounts).join(', ');
      console.error(`Error: Account required. Use -a <account> or set TGMANAGER_DEFAULT_ACCOUNT env var.`);
      console.error(`Available accounts: ${available}`);
      process.exit(1);
    }
    const account = options.account;

    // Validate inputs
    validateCommand(command, options);
    validateAccountName(account, Object.keys(config.accounts));

    // Queue management commands (no lock or TG client needed)
    if (command === 'queue-status') {
      const { queueStatusCommand } = await import('./commands/queue-status-command.js');
      await queueStatusCommand(account);
      process.exit(0);
    }

    if (command === 'queue-cancel' && name) {
      const { queueCancelCommand } = await import('./commands/queue-cancel-command.js');
      const success = await queueCancelCommand(account, name);
      process.exit(success ? 0 : 1);
    }

    // Handle upload-storage: add to queue BEFORE lock
    let queuedJob: any = null;
    let queuedJobIds: string[] = [];
    let uploadPath: string | undefined;

    if (filePath) {
      // Resolve file paths: absolute paths used as-is, relative paths resolved against CWD
      if (filePath.startsWith('/')) {
        uploadPath = filePath;
      } else {
        uploadPath = resolve(filePath);
      }

      // Ensure the uploads directory exists
      if (!existsSync(config.app.uploadDir)) {
        mkdirSync(config.app.uploadDir, { recursive: true });
      }
    }

    if (command === 'upload-storage' && uploadPath && options.virtualPath) {
      // Validate path exists
      if (!existsSync(uploadPath)) {
        logger.error(`File not found: ${uploadPath}`);
        console.error(`❌ File not found: ${uploadPath}`);
        process.exit(1);
      }

      // Fetch existing storage files for duplicate detection (unless --force)
      let existingFiles: import('./storage/storage-service.js').StoredFileInfo[] = [];
      if (!options.force) {
        try {
          const dedupClient = await startClient(account);
          const { StorageService } = await import('./storage/storage-service.js');
          const storageService = new StorageService(dedupClient, { storageChannelId: options.storageChannel });
          await storageService.initializeStorageChannel();
          existingFiles = await storageService.listStoredFiles();
          await dedupClient.disconnect();
        } catch (err) {
          logger.warn('Failed to check for duplicates, proceeding without dedup', { error: (err as Error).message });
        }
      }

      const { addJob, getQueuePosition } = await import('./queue/queue-manager.js');

      if (statSync(uploadPath).isDirectory()) {
        // Directory mode: walk, compute virtual paths, batch-queue
        const entries = await walkDirectory(uploadPath);
        if (entries.length === 0) {
          console.error(`❌ No files found in directory: ${basename(uploadPath)}`);
          process.exit(1);
        }

        const dirName = basename(uploadPath);
        const jobIds: string[] = [];
        let skippedCount = 0;

        for (const entry of entries) {
          // Virtual path = base + dirname + relative path (posix-normalized)
          const fileVirtualPath = posix.join(options.virtualPath, dirName, entry.relativePath.split('/').join('/'));

          // Check for path duplicate in storage
          if (existingFiles.length > 0 && existingFiles.some(f => f.virtualPath === fileVirtualPath)) {
            skippedCount++;
            continue;
          }

          const job = addJob(account, {
            filePath: entry.absolutePath,
            virtualPath: fileVirtualPath,
            storageChannelId: options.storageChannel,
            deleteSource,
          });
          jobIds.push(job.id);
        }

        if (jobIds.length > 0) {
          console.log(`\n✓ Queued ${jobIds.length} files from '${dirName}' for upload`);
        }
        if (skippedCount > 0) {
          console.log(`⏭  Skipped ${skippedCount} file(s) already in storage`);
        }
        if (jobIds.length === 0 && skippedCount > 0) {
          console.log(`\nAll ${skippedCount} files already in storage. Nothing to queue.`);
          process.exit(0);
        }
        logger.info('Directory queued', { dir: dirName, queued: jobIds.length, skipped: skippedCount });
        queuedJobIds = jobIds;
      } else {
        // Single file mode — check path duplicate
        if (existingFiles.length > 0 && existingFiles.some(f => f.virtualPath === options.virtualPath)) {
          console.log(`⏭  Skipped: "${options.virtualPath}" already exists in storage. Use --force to re-upload.`);
          process.exit(0);
        }

        queuedJob = addJob(account, {
          filePath: uploadPath,
          virtualPath: options.virtualPath,
          storageChannelId: options.storageChannel,
          deleteSource
        });
        const position = getQueuePosition(account, queuedJob.id);
        console.log(`\n✓ Added to upload queue (position: ${position})`);
        logger.info('Job added to queue', { jobId: queuedJob.id, position });
      }
    }

    // Create and acquire process lock
    const lockDir = join(config.app.sessionDir, '..', 'locks');
    processLock = createProcessLock(lockDir, account);
    processLock.setupCleanup();

    if (!processLock.acquire()) {
      // For upload-storage: job(s) already queued, handle --wait or exit
      const hasQueuedWork = queuedJob || queuedJobIds.length > 0;
      if (command === 'upload-storage' && hasQueuedWork) {
        if (options.wait) {
          console.log('⏳ Waiting for upload to complete...\n');
          const { pollJobStatusUntilDone } = await import('./queue/queue-process-utils.js');
          const { getJob } = await import('./queue/queue-manager.js');
          const idsToWait = queuedJobIds.length > 0 ? queuedJobIds : [queuedJob.id];
          const results = await Promise.all(idsToWait.map(id => pollJobStatusUntilDone(getJob, account, id, 1000)));
          const allSuccess = results.every(Boolean);
          process.exit(allSuccess ? 0 : 1);
        }
        console.log('✓ Worker is active. Upload queued and will be processed.\n');
        process.exit(0);
      }

      // Other commands: original error
      logger.error('Failed to acquire process lock. Another instance may be running.');
      console.error('\n⚠️  Another instance is already running with this account.');
      console.error('Please wait for it to finish or stop it before starting a new one.\n');
      process.exit(1);
    }
    
    if (chatId) {
      validateChatId(chatId);
    }

    const client = await startClient(account);

    if (command === 'upload' && chatId && uploadPath) {
      // Check if path exists
      if (!existsSync(uploadPath)) {
        logger.error(`Path does not exist: ${uploadPath}`);
        process.exit(1);
      }

      const stats = statSync(uploadPath);
      
      // Create single Uploader instance for the entire batch (enables premium status caching)
      const uploader = new Uploader(client);

      if (stats.isDirectory()) {
        // Handle directory with concurrent uploads
        const allFiles = await readdir(uploadPath);
        const files = allFiles
          .filter((file: string) => !file.startsWith('.')) // Skip hidden files
          .map((file: string) => join(uploadPath, file));

        logger.info(`Found ${files.length} files in directory ${uploadPath}`);

        // Create concurrency limiter using config value
        const concurrencyLimit = config.app.maxConcurrentUploads;
        const limit = pLimit(concurrencyLimit);
        logger.info(`Using concurrent uploads`, { maxConcurrent: concurrencyLimit });

        // Execute uploads concurrently with limit
        const uploadPromises = files.map((file: string) =>
          limit(async () => {
            logger.info(`Starting upload: ${basename(file)}`);
            return uploadSingleFile(uploader, chatId, file, deleteSource);
          })
        );

        const results = await Promise.all(uploadPromises);
        const successCount = results.filter(Boolean).length;
        const failCount = results.filter((r) => !r).length;

        logger.info(`Upload batch complete`, {
          total: files.length,
          successful: successCount,
          failed: failCount,
          concurrency: concurrencyLimit
        });

        // Delete the source directory if requested and all files were uploaded successfully
        if (deleteSource && failCount === 0) {
          try {
            rmSync(uploadPath, { recursive: false });
            logger.info(`Deleted source directory: ${uploadPath}`);
          } catch (error) {
            logger.error(`Failed to delete directory`, { path: uploadPath, error: (error as Error).message });
          }
        } else if (deleteSource && failCount > 0) {
          logger.warn(`Directory not deleted due to failed uploads`, { failCount });
        }
      } else {
        // Handle single file
        const success = await uploadSingleFile(uploader, chatId, uploadPath, deleteSource);
        if (!success) {
          logger.error('Failed to upload file');
          process.exit(1);
        }
      }
      process.exit(0);
    } else if (command === 'create') {
      const sanitizedName = sanitizeInput(name || '');

      const result = await client.invoke(
        new Api.channels.CreateChannel({
          title: sanitizedName,
          about: '',
          broadcast: true,
          megagroup: false,
        })
      );

      // Validate channel creation result
      if (!result || !(result as any).chats || (result as any).chats.length === 0) {
        throw new Error('Failed to create channel: no channel data returned');
      }

      const channel = (result as any).chats[0] as Api.Channel;
      const channelId = `-100${channel.id.toJSNumber()}`;
      logger.info('Channel created successfully', { channelId, name: sanitizedName });
      process.exit(0);
    } else if (command === 'upload-storage') {
      const { startWorker } = await import('./queue/queue-worker.js');
      const result = await startWorker(account, client);
      process.exit(result.failed > 0 ? 1 : 0);

    } else if (command === 'download-storage' && options.virtualPath) {
      const { downloadStorageCommand } = await import('./commands/download-storage-command.js');
      const success = await downloadStorageCommand(client, {
        virtualPath: options.virtualPath,
        outputPath: options.outputPath,
        storageChannelId: options.storageChannel,
        force: options.force
      });
      process.exit(success ? 0 : 1);

    } else if (command === 'list-storage') {
      const { listStorageCommand } = await import('./commands/list-storage-command.js');
      const success = await listStorageCommand(client, {
        pathPrefix: options.virtualPath,
        storageChannelId: options.storageChannel
      });
      process.exit(success ? 0 : 1);
    }
  } catch (error) {
    // Handle AUTH_KEY_DUPLICATED error specially
    if (error instanceof AuthKeyDuplicatedError ||
        (error as any).code === 406 ||
        (error as Error).message.includes('AUTH_KEY_DUPLICATED')) {
      const authError = error instanceof AuthKeyDuplicatedError ? error : new AuthKeyDuplicatedError();
      const message = handleError(authError);
      console.error('\n❌ ' + message + '\n');
      process.exit(1);
    }

    logger.error('Fatal error', { error: (error as Error).message, stack: (error as Error).stack });
    process.exit(1);
  } finally {
    // Release the lock if it was acquired
    if (processLock) {
      processLock.release();
    }
  }
};

main();