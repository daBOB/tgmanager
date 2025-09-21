import { Api, TelegramClient } from 'telegram';
import input from 'input';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, unlinkSync } from 'fs';
import { Command } from 'commander';
import { Uploader } from './Uploader.js';
import { join, basename } from 'path';
import config from './config.js';
import logger from './logger.js';
import { validatePath, validateChatId, validateAccountName, validateCommand, sanitizeInput } from './utils/validation.js';
import { createSession } from './session-helper.js';
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
    } else {
      logger.info('Client disconnected');
    }
    process.exit(1);
  });

  (client as any).on('error', (err: Error) => {
    logger.error('Client error', { error: err.message, code: (err as any).code });
  });

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => password || '',
    phoneCode: async () =>
      await input.text('Please enter the code you received: '),
    onError: (err: Error) => { logger.error('Authentication error', { error: err.message }); },
  });
  logger.info('Successfully connected to Telegram');
  client.session.save();
  return client;
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
  .requiredOption('-a, --account <account>', 'Account name')
  .option('-c, --command <command>', 'Command to execute')
  .option('-i, --chat-id <id>', 'Chat ID')
  .option('-f, --file-path <path>', 'File path')
  .option('-n, --name <name>', 'Name')
  .option('--delete-source', 'Delete the source file after the operation');

program.parse(process.argv);

const options = program.opts<CommandOptions>();

const uploadSingleFile = async (client: TelegramClient, chatId: string, filePath: string, deleteSource?: boolean): Promise<boolean> => {
  const uploader = new Uploader(client);
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
  try {
    const { account, command, chatId, filePath, deleteSource, name } = options;
    
    // Validate inputs
    validateCommand(command, options);
    validateAccountName(account, Object.keys(config.accounts));
    
    if (chatId) {
      validateChatId(chatId);
    }

    let uploadPath: string | undefined;
    if (filePath) {
      // Handle absolute paths correctly with validation
      if (filePath.startsWith('/')) {
        uploadPath = filePath;
      } else {
        uploadPath = validatePath(filePath, config.app.uploadDir);
      }
      
      // Ensure the uploads directory exists
      if (!existsSync(config.app.uploadDir)) {
        mkdirSync(config.app.uploadDir, { recursive: true });
      }
    }

    const client = await startClient(account);

    if (command === 'upload' && chatId && uploadPath) {
      // Check if path exists
      if (!existsSync(uploadPath)) {
        logger.error(`Path does not exist: ${uploadPath}`);
        process.exit(1);
      }

      const stats = statSync(uploadPath);
      
      if (stats.isDirectory()) {
        // Handle directory
        const files = readdirSync(uploadPath)
          .filter(file => !file.startsWith('.')) // Skip hidden files
          .map(file => join(uploadPath, file));
        
        logger.info(`Found ${files.length} files in directory ${uploadPath}`);
        
        let successCount = 0;
        let failCount = 0;

        for (const file of files) {
          logger.info(`Starting upload: ${basename(file)}`);
          const success = await uploadSingleFile(client, chatId, file, deleteSource);
          if (success) {
            successCount++;
          } else {
            failCount++;
          }
        }

        logger.info(`Upload batch complete`, {
          total: files.length,
          successful: successCount,
          failed: failCount
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
        const success = await uploadSingleFile(client, chatId, uploadPath, deleteSource);
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
      const channel = (result as any).chats[0] as Api.Channel;
      const channelId = `-100${channel.id.toJSNumber()}`;
      logger.info('Channel created successfully', { channelId, name: sanitizedName });
      process.exit(0);
    }
  } catch (error) {
    logger.error('Fatal error', { error: (error as Error).message, stack: (error as Error).stack });
    process.exit(1);
  }
};

main();