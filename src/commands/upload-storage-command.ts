// src/commands/upload-storage-command.ts
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import { Api } from 'telegram';
import cliProgress from 'cli-progress';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import {
  splitFile,
  needsSplitting,
  cleanupChunks
} from '../storage/file-splitter.js';
import {
  createManifest,
  saveManifest,
  updateManifestStatus,
  getManifestPath
} from '../storage/manifest-manager.js';
import { hashFile } from '../storage/checksum-utils.js';
import logger from '../logger.js';
import config from '../config.js';

export interface UploadStorageOptions {
  filePath: string;
  virtualPath: string;
  storageChannelId?: string;
  deleteSource?: boolean;
}

/**
 * Upload file to storage channel with automatic splitting for large files
 */
export async function uploadStorageCommand(
  client: TelegramClient,
  options: UploadStorageOptions
): Promise<boolean> {
  const { filePath, virtualPath, storageChannelId } = options;

  // Validate file exists
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

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  // Check if file needs splitting
  const isPremium = await checkPremiumStatus(client);
  const requiresSplit = needsSplitting(fileSize, isPremium);

  if (requiresSplit) {
    return uploadWithSplitting(client, storage, options, fileSize);
  } else {
    return uploadDirect(client, storage, options, fileSize);
  }
}

/**
 * Upload large file with splitting into chunks
 */
async function uploadWithSplitting(
  _client: TelegramClient,
  storage: StorageService,
  options: UploadStorageOptions,
  _fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);

  // Create temp directory for chunks
  const tempDir = join(config.app.uploadDir, '.storage-temp');

  console.log('File exceeds size limit, splitting into chunks...\n');

  // Progress bar for splitting
  const splitBar = new cliProgress.SingleBar({
    format: 'Splitting |{bar}| {percentage}% | Chunk {currentChunk}/{totalChunks}',
  }, cliProgress.Presets.shades_classic);

  splitBar.start(100, 0, { currentChunk: 0, totalChunks: '?' });

  try {
    // Split file
    const { manifest } = await splitFile(filePath, {
      outputDir: tempDir,
      virtualPath,
      onProgress: (progress) => {
        splitBar.update(progress.percentage, {
          currentChunk: progress.currentChunk + 1,
          totalChunks: progress.totalChunks
        });
      }
    });

    splitBar.stop();
    console.log(`\nCreated ${manifest.totalChunks} chunks\n`);

    // Progress bar for uploading
    const uploadBar = new cliProgress.SingleBar({
      format: 'Uploading |{bar}| {percentage}% | Chunk {chunkIndex}/{totalChunks}',
    }, cliProgress.Presets.shades_classic);

    uploadBar.start(100, 0, { chunkIndex: 0, totalChunks: manifest.totalChunks });

    // Upload chunks
    const updatedManifest = await storage.uploadAllChunks(tempDir, manifest, (progress) => {
      uploadBar.update(progress.percentage, {
        chunkIndex: progress.chunkIndex + 1,
        totalChunks: progress.totalChunks
      });
    });

    uploadBar.stop();

    // Update manifest status and upload
    const finalManifest = updateManifestStatus(updatedManifest, 'complete');
    await storage.uploadManifest(finalManifest);

    // Save local manifest copy
    const manifestPath = getManifestPath(tempDir, finalManifest.fileId);
    await saveManifest(finalManifest, manifestPath);

    // Cleanup chunks
    await cleanupChunks(finalManifest, tempDir);

    console.log(`\n✓ Upload complete: ${fileName}`);
    console.log(`  Virtual path: ${virtualPath}`);
    console.log(`  File ID: ${finalManifest.fileId}`);

    logger.info('Storage upload complete', {
      fileId: finalManifest.fileId,
      virtualPath,
      chunks: finalManifest.totalChunks
    });

    return true;
  } catch (error) {
    splitBar.stop();
    logger.error('Storage upload failed', {
      filePath,
      error: (error as Error).message
    });
    console.error(`\n✗ Upload failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Upload small file directly without splitting (single-chunk manifest)
 */
async function uploadDirect(
  _client: TelegramClient,
  storage: StorageService,
  options: UploadStorageOptions,
  fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);

  const progressBar = new cliProgress.SingleBar({
    format: 'Uploading |{bar}| {percentage}%',
  }, cliProgress.Presets.shades_classic);

  progressBar.start(100, 0);

  try {
    // Calculate file hash
    const { hash } = await hashFile(filePath);

    // Create single-chunk manifest
    const manifest = createManifest(fileName, virtualPath, fileSize, hash, fileSize);

    // Add single chunk info
    manifest.chunks = [{
      index: 0,
      filename: fileName,
      size: fileSize,
      hash,
      uploaded: false
    }];

    // Upload file as single chunk
    const messageId = await storage.uploadChunk(filePath, manifest, 0, (p) => {
      progressBar.update(p);
    });

    progressBar.stop();

    // Update manifest with message ID and status
    const chunk = manifest.chunks[0];
    if (chunk) {
      chunk.messageId = messageId;
      chunk.uploadedAt = new Date().toISOString();
      chunk.uploaded = true;
    }
    manifest.status = 'complete';
    manifest.updatedAt = new Date().toISOString();

    await storage.uploadManifest(manifest);

    console.log(`\n✓ Upload complete: ${fileName}`);
    console.log(`  Virtual path: ${virtualPath}`);
    console.log(`  File ID: ${manifest.fileId}`);

    return true;
  } catch (error) {
    progressBar.stop();
    logger.error('Direct upload failed', { error: (error as Error).message });
    console.error(`\n✗ Upload failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Check if user has Telegram Premium
 */
async function checkPremiumStatus(client: TelegramClient): Promise<boolean> {
  try {
    const result = await client.invoke(
      new Api.users.GetFullUser({ id: 'Me' })
    );
    const user = result.users?.[0] as any;
    return !!user?.premium;
  } catch {
    return false;
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
