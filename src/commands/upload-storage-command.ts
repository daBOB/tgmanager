// src/commands/upload-storage-command.ts
// Thin orchestrator: validates input, initialises storage, delegates to split or direct uploader
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename } from 'path';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import { needsSplitting } from '../storage/file-splitter.js';
import logger from '../logger.js';
import { checkPremiumStatus, formatBytes } from './upload-storage-telegram-utils.js';
import { uploadWithSplitting } from './upload-storage-split-uploader.js';
import { uploadDirect } from './upload-storage-direct-uploader.js';
import type { UploadStorageOptions } from './upload-storage-types.js';

export type { UploadStorageOptions };

/** Upload file to storage channel with automatic splitting for large files */
export async function uploadStorageCommand(
  client: TelegramClient,
  options: UploadStorageOptions
): Promise<boolean> {
  const { filePath, virtualPath, storageChannelId } = options;

  if (!existsSync(filePath)) {
    logger.error('File not found', { filePath });
    console.error(`Error: File not found: ${filePath}`);
    return false;
  }

  const stats = await stat(filePath);
  const fileName = basename(filePath);
  const fileSize = stats.size;

  console.log(`\nUploading: ${fileName}`);
  console.log(`Size: ${formatBytes(fileSize)}`);
  console.log(`Virtual path: ${virtualPath}\n`);

  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  const isPremium = await checkPremiumStatus(client);
  const requiresSplit = needsSplitting(fileSize, isPremium);

  if (requiresSplit) {
    return uploadWithSplitting(client, storage, options, fileSize);
  } else {
    return uploadDirect(storage, options, fileSize);
  }
}
