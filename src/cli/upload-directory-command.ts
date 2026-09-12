// Handles the `upload` command: sends a single file, or every file in a
// directory, straight to a chat (as opposed to the storage-channel commands).
import { existsSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import pLimit from 'p-limit';
import type { TelegramClient } from 'telegram';
import { Uploader } from '../Uploader.js';
import config from '../config.js';
import logger from '../logger.js';
import type { CommandOptions } from '../types/index.js';

/** Upload one file, optionally removing the source once it has landed. */
async function uploadSingleFile(
  uploader: Uploader,
  chatId: string,
  filePath: string,
  deleteSource?: boolean
): Promise<boolean> {
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
}

/**
 * Run the `upload` command.
 * @returns process exit code
 */
export async function runUploadCommand(
  client: TelegramClient,
  chatId: string,
  uploadPath: string,
  options: CommandOptions
): Promise<number> {
  if (!existsSync(uploadPath)) {
    logger.error(`Path does not exist: ${uploadPath}`);
    return 1;
  }

  const stats = statSync(uploadPath);
  // One Uploader for the whole batch: it caches premium status across files.
  const uploader = new Uploader(client);

  if (!stats.isDirectory()) {
    const success = await uploadSingleFile(uploader, chatId, uploadPath, options.deleteSource);
    if (!success) logger.error('Failed to upload file');
    return success ? 0 : 1;
  }

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

  const failCount = results.filter(r => !r).length;
  logger.info(`Upload batch complete`, {
    total: files.length,
    successful: results.filter(Boolean).length,
    failed: failCount,
    concurrency: concurrencyLimit,
  });

  if (options.deleteSource) {
    if (failCount === 0) {
      try {
        rmSync(uploadPath, { recursive: false });
        logger.info(`Deleted source directory: ${uploadPath}`);
      } catch (error) {
        logger.error(`Failed to delete directory`, {
          path: uploadPath,
          error: (error as Error).message,
        });
      }
    } else {
      logger.warn(`Directory not deleted due to failed uploads`, { failCount });
    }
  }

  return 0;
}
