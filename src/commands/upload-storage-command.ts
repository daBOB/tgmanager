// src/commands/upload-storage-command.ts
// Thin orchestrator: validates input, then delegates to the split or direct uploader
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename } from 'path';
import type { TelegramClient } from '../types/index.js';
import type { StorageService } from '../storage/storage-service.js';
import { needsSplitting } from '../storage/file-splitter.js';
import logger from '../logger.js';
import { formatBytes } from './upload-storage-telegram-utils.js';
import { uploadWithSplitting } from './upload-storage-split-uploader.js';
import { uploadDirect } from './upload-storage-direct-uploader.js';
import type { UploadStorageOptions } from './upload-storage-types.js';
import { print, printError } from '../utils/console-output.js';

export type { UploadStorageOptions };

/** Upload file to storage channel with automatic splitting for large files */
export async function uploadStorageCommand(
  client: TelegramClient,
  options: UploadStorageOptions,
  /**
   * Initialised storage service, supplied by the caller. Passing it in is what
   * lets a batch share one cached channel index instead of walking the channel
   * once per file, so ownership of the instance stays with the caller.
   */
  storage: StorageService
): Promise<boolean> {
  const { filePath, virtualPath } = options;

  if (!existsSync(filePath)) {
    logger.error('File not found', { filePath });
    printError(`Error: File not found: ${filePath}`);
    return false;
  }

  const stats = await stat(filePath);
  const fileName = basename(filePath);
  const fileSize = stats.size;

  print(`\nUploading: ${fileName}`);
  print(`Size: ${formatBytes(fileSize)}`);
  print(`Virtual path: ${virtualPath}\n`);

  const requiresSplit = needsSplitting(fileSize);

  if (requiresSplit) {
    return uploadWithSplitting(client, storage, options, fileSize);
  } else {
    return uploadDirect(storage, options, fileSize);
  }
}
