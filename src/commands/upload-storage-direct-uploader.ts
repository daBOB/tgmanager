// src/commands/upload-storage-direct-uploader.ts
// Handles uploading small files directly as a single chunk (no splitting required)
import { basename } from 'path';
import { StorageService } from '../storage/storage-service.js';
import { createManifest } from '../storage/manifest-manager.js';
import { hashFile } from '../storage/checksum-utils.js';
import logger from '../logger.js';
import type { UploadStorageOptions } from './upload-storage-types.js';
import { createDirectUploadProgressBar } from './upload-storage-progress-reporter.js';

/** Upload file as a single chunk with a single-entry manifest */
export async function uploadDirect(
  storage: StorageService,
  options: UploadStorageOptions,
  fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);

  const progressBar = createDirectUploadProgressBar();
  progressBar.start(100, 0);

  try {
    const { hash } = await hashFile(filePath);

    // Skip duplicate content unless --force
    if (!options.force) {
      const existing = await storage.findByHash(hash);
      if (existing) {
        progressBar.stop();
        console.log(`\n⏭  Skipped: identical content already in storage at "${existing.virtualPath}"`);
        logger.info('Duplicate upload skipped (hash match)', { hash, existingPath: existing.virtualPath });
        return true;
      }
    }

    const manifest = createManifest(fileName, virtualPath, fileSize, hash, fileSize);

    manifest.chunks = [{
      index: 0,
      filename: fileName,
      size: fileSize,
      hash,
      uploaded: false
    }];

    const messageId = await storage.uploadChunk(filePath, manifest, 0, (p) => {
      progressBar.update(p);
    });

    progressBar.stop();

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
