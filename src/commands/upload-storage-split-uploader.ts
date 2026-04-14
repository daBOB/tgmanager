// src/commands/upload-storage-split-uploader.ts
// Handles uploading large files by splitting into chunks and uploading each chunk
import { basename, join } from 'path';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import { splitFile, cleanupChunks } from '../storage/file-splitter.js';
import { saveManifest, updateManifestStatus, getManifestPath } from '../storage/manifest-manager.js';
import logger from '../logger.js';
import config from '../config.js';
import type { UploadStorageOptions } from './upload-storage-types.js';
import { createSplitProgressBar, createChunkUploadProgressBar } from './upload-storage-progress-reporter.js';

/** Upload large file by splitting into chunks, uploading each, then finalizing manifest */
export async function uploadWithSplitting(
  _client: TelegramClient,
  storage: StorageService,
  options: UploadStorageOptions,
  _fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);
  const tempDir = join(config.app.uploadDir, '.storage-temp');

  console.log('File exceeds size limit, splitting into chunks...\n');

  const splitBar = createSplitProgressBar();
  splitBar.start(100, 0, { currentChunk: 0, totalChunks: '?' });

  let manifest: any = null;

  try {
    const result = await splitFile(filePath, {
      outputDir: tempDir,
      virtualPath,
      onProgress: (progress) => {
        splitBar.update(progress.percentage, {
          currentChunk: progress.currentChunk + 1,
          totalChunks: progress.totalChunks
        });
      }
    });
    manifest = result.manifest;
    splitBar.stop();

    // Skip duplicate content unless --force
    if (!options.force) {
      const existing = await storage.findByHash(manifest.originalHash);
      if (existing) {
        console.log(`\n⏭  Skipped: identical content already in storage at "${existing.virtualPath}"`);
        logger.info('Duplicate upload skipped (hash match)', { hash: manifest.originalHash, existingPath: existing.virtualPath });
        await cleanupChunks(manifest, tempDir);
        return true;
      }
    }

    console.log(`\nCreated ${manifest.totalChunks} chunks\n`);

    const uploadBar = createChunkUploadProgressBar();
    uploadBar.start(100, 0, { chunkIndex: 0, totalChunks: manifest.totalChunks });

    const updatedManifest = await storage.uploadAllChunks(tempDir, manifest, (progress) => {
      uploadBar.update(progress.percentage, {
        chunkIndex: progress.chunkIndex + 1,
        totalChunks: progress.totalChunks
      });
    });

    uploadBar.stop();

    const finalManifest = updateManifestStatus(updatedManifest, 'complete');
    await storage.uploadManifest(finalManifest);

    const manifestPath = getManifestPath(tempDir, finalManifest.fileId);
    await saveManifest(finalManifest, manifestPath);

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

    if (manifest) {
      try {
        await cleanupChunks(manifest, tempDir);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup chunks after upload failure', {
          error: (cleanupError as Error).message
        });
      }
    }

    logger.error('Storage upload failed', { filePath, error: (error as Error).message });
    console.error(`\n✗ Upload failed: ${(error as Error).message}`);
    return false;
  }
}
