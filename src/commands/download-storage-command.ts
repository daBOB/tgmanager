// src/commands/download-storage-command.ts
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import cliProgress from 'cli-progress';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import { mergeChunks, cleanupChunks } from '../storage/file-splitter.js';
import logger from '../logger.js';
import config from '../config.js';
import { print, printError } from '../utils/console-output.js';
import { formatBytes } from './upload-storage-telegram-utils.js';

export interface DownloadStorageOptions {
  virtualPath: string;
  outputPath?: string;
  storageChannelId?: string;
  force?: boolean;
}

/**
 * Download file from storage channel by virtual path
 */
export async function downloadStorageCommand(
  client: TelegramClient,
  options: DownloadStorageOptions
): Promise<boolean> {
  const { virtualPath, outputPath, storageChannelId, force } = options;

  print(`\nSearching for: ${virtualPath}\n`);

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  // Find file by virtual path
  const fileInfo = await storage.findByPath(virtualPath);

  if (!fileInfo) {
    printError(`Error: File not found: ${virtualPath}`);
    logger.error('File not found in storage', { virtualPath });
    return false;
  }

  print(`Found: ${fileInfo.originalName}`);
  print(`Size: ${formatBytes(fileInfo.size)}`);
  print(`Status: ${fileInfo.status}\n`);

  if (fileInfo.status !== 'complete') {
    printError('Error: File upload incomplete or failed');
    return false;
  }

  // Get full manifest
  const manifest = await storage.getManifestFromMessage(fileInfo.manifestMessageId);
  if (!manifest) {
    printError('Error: Could not retrieve file manifest');
    return false;
  }

  // Determine output path
  const finalOutputPath = outputPath || join(process.cwd(), manifest.originalName);
  const outputDir = dirname(finalOutputPath);

  // Check if output already exists
  if (existsSync(finalOutputPath) && !force) {
    printError(`Error: Output file already exists: ${finalOutputPath}`);
    printError('Use --force to overwrite or specify different --output-path');
    return false;
  }

  // Create output directory if needed
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Create temp directory for chunks
  const tempDir = join(config.app.uploadDir, '.storage-temp', manifest.fileId);
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  print(`Downloading ${manifest.totalChunks} chunk(s)...\n`);

  // Progress bar for downloading
  const downloadBar = new cliProgress.SingleBar({
    format: 'Downloading |{bar}| {percentage}% | Chunk {chunkIndex}/{totalChunks}',
  }, cliProgress.Presets.shades_classic);

  downloadBar.start(100, 0, { chunkIndex: 0, totalChunks: manifest.totalChunks });

  try {
    // Download all chunks
    for (let i = 0; i < manifest.chunks.length; i++) {
      const chunk = manifest.chunks[i];
      if (!chunk) {
        throw new Error(`Chunk ${i} not found in manifest`);
      }
      if (!chunk.messageId) {
        throw new Error(`Missing message ID for chunk ${i}`);
      }

      const chunkPath = join(tempDir, chunk.filename);
      const chunkHash = chunk.hash;
      const chunkMessageId = chunk.messageId;

      // Retry chunk download with exponential backoff
      let success = false;
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        success = await storage.downloadChunk(
          chunkMessageId,
          chunkPath,
          chunkHash,
          (p) => {
            const overallProgress = ((i + p / 100) / manifest.totalChunks) * 100;
            downloadBar.update(overallProgress, {
              chunkIndex: i + 1,
              totalChunks: manifest.totalChunks
            });
          }
        );

        if (success) break;

        if (attempt < maxRetries - 1) {
          logger.warn('Chunk download failed, retrying', {
            chunkIndex: i,
            attempt: attempt + 1,
            maxRetries
          });
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); // exponential backoff
        }
      }

      if (!success) {
        throw new Error(`Failed to download chunk ${i} after ${maxRetries} attempts`);
      }
    }

    downloadBar.stop();
    print('\nMerging chunks...');

    // Merge chunks
    const mergeBar = new cliProgress.SingleBar({
      format: 'Merging |{bar}| {percentage}%',
    }, cliProgress.Presets.shades_classic);

    mergeBar.start(100, 0);

    const mergeSuccess = await mergeChunks(manifest, tempDir, finalOutputPath, (progress) => {
      mergeBar.update(progress.percentage);
    });

    mergeBar.stop();

    if (!mergeSuccess) {
      printError('\n✗ File integrity verification failed');
      return false;
    }

    // Cleanup temp chunks
    await cleanupChunks(manifest, tempDir);

    print(`\n✓ Download complete: ${finalOutputPath}`);
    logger.info('Storage download complete', {
      fileId: manifest.fileId,
      outputPath: finalOutputPath
    });

    return true;
  } catch (error) {
    downloadBar.stop();
    logger.error('Storage download failed', {
      virtualPath,
      error: (error as Error).message
    });
    printError(`\n✗ Download failed: ${(error as Error).message}`);
    return false;
  }
}

