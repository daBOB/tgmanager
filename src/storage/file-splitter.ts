// src/storage/file-splitter.ts
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import {
  FileManifest,
  createManifest,
  addChunkToManifest,
  updateManifestStatus,
  saveManifest,
  DEFAULT_CHUNK_SIZE
} from './manifest-manager.js';
import logger from '../logger.js';

export interface SplitOptions {
  chunkSize?: number;
  outputDir: string;
  virtualPath: string;
  onProgress?: (progress: SplitProgress) => void;
}

export interface SplitProgress {
  totalBytes: number;
  processedBytes: number;
  currentChunk: number;
  totalChunks: number;
  percentage: number;
}

export interface SplitResult {
  manifest: FileManifest;
  chunkPaths: string[];
}

/**
 * Get chunk filename for a given file ID and index
 */
export function getChunkFilename(fileId: string, index: number): string {
  return `${fileId}-chunk-${index.toString().padStart(3, '0')}`;
}

/**
 * Split a large file into chunks using byte-range streaming.
 * Each chunk is read directly from the source using start/end offsets,
 * piped through a hash transform, and written to disk — zero memory accumulation.
 */
export async function splitFile(
  inputPath: string,
  options: SplitOptions
): Promise<SplitResult> {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    outputDir,
    virtualPath,
    onProgress
  } = options;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Get file stats
  const stats = await stat(inputPath);
  const originalSize = stats.size;
  const originalName = basename(inputPath);
  const totalChunks = Math.ceil(originalSize / chunkSize);

  logger.info('Starting file split', {
    file: originalName,
    size: originalSize,
    chunkSize,
    totalChunks
  });

  // Compute whole-file hash and split in a single pass:
  // Stream the file once, forking data to a file-level hash and to per-chunk output files.
  const fileHash = createHash('sha256');
  let manifest = createManifest(originalName, virtualPath, originalSize, '', chunkSize);
  const chunkPaths: string[] = [];

  let globalBytesProcessed = 0;
  let currentChunkIndex = 0;
  let currentChunkBytesWritten = 0;
  let currentChunkHash = createHash('sha256');
  let currentChunkFilename = getChunkFilename(manifest.fileId, currentChunkIndex);
  let currentChunkPath = join(outputDir, currentChunkFilename);
  let currentWriteStream = createWriteStream(currentChunkPath);

  const splitter = new Transform({
    transform(data: Buffer, _encoding, callback) {
      let offset = 0;

      const processData = async () => {
        while (offset < data.length) {
          const remainingInChunk = chunkSize - currentChunkBytesWritten;
          const bytesToWrite = Math.min(remainingInChunk, data.length - offset);
          const slice = data.subarray(offset, offset + bytesToWrite);

          // Feed into whole-file hash
          fileHash.update(slice);

          // Feed into current chunk hash
          currentChunkHash.update(slice);

          // Write to current chunk file (handle backpressure)
          const canContinue = currentWriteStream.write(slice);
          if (!canContinue) {
            await new Promise<void>(resolve => currentWriteStream.once('drain', resolve));
          }

          currentChunkBytesWritten += bytesToWrite;
          globalBytesProcessed += bytesToWrite;
          offset += bytesToWrite;

          // Report progress
          if (onProgress) {
            onProgress({
              totalBytes: originalSize,
              processedBytes: globalBytesProcessed,
              currentChunk: currentChunkIndex,
              totalChunks,
              percentage: Math.floor((globalBytesProcessed / originalSize) * 100)
            });
          }

          // Current chunk is full — finalize it and start next
          if (currentChunkBytesWritten >= chunkSize && globalBytesProcessed < originalSize) {
            await finalizeCurrentChunk();
            startNextChunk();
          }
        }
      };

      processData().then(() => callback()).catch(callback);
    },

    flush(callback) {
      // Finalize the last chunk (may have remaining data)
      finalizeCurrentChunk()
        .then(() => callback())
        .catch(callback);
    }
  });

  async function finalizeCurrentChunk(): Promise<void> {
    // Close the write stream
    await new Promise<void>((resolve, reject) => {
      currentWriteStream.end((err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const chunkHash = currentChunkHash.digest('hex');

    manifest = addChunkToManifest(manifest, {
      index: currentChunkIndex,
      filename: currentChunkFilename,
      size: currentChunkBytesWritten,
      hash: chunkHash,
      uploaded: false
    });
    chunkPaths.push(currentChunkPath);

    logger.debug('Chunk written', {
      chunk: currentChunkIndex,
      size: currentChunkBytesWritten,
      hash: chunkHash
    });
  }

  function startNextChunk(): void {
    currentChunkIndex++;
    currentChunkBytesWritten = 0;
    currentChunkHash = createHash('sha256');
    currentChunkFilename = getChunkFilename(manifest.fileId, currentChunkIndex);
    currentChunkPath = join(outputDir, currentChunkFilename);
    currentWriteStream = createWriteStream(currentChunkPath);
  }

  // Single-pass: read source file once, split + hash simultaneously
  const readStream = createReadStream(inputPath, { highWaterMark: 1024 * 1024 });

  await pipeline(readStream, splitter);

  // Set the whole-file hash on the manifest
  manifest.originalHash = fileHash.digest('hex');
  logger.debug('Original file hash calculated', { hash: manifest.originalHash });

  // Update manifest status
  manifest = updateManifestStatus(manifest, 'uploading');

  // Save manifest
  const manifestPath = join(outputDir, `${manifest.fileId}.manifest.json`);
  await saveManifest(manifest, manifestPath);

  logger.info('File split complete', {
    fileId: manifest.fileId,
    totalChunks: manifest.totalChunks,
    manifestPath
  });

  return { manifest, chunkPaths };
}

/**
 * Merge chunks back into original file with integrity verification
 */
export async function mergeChunks(
  manifest: FileManifest,
  chunksDir: string,
  outputPath: string,
  onProgress?: (progress: SplitProgress) => void
): Promise<boolean> {
  logger.info('Starting chunk merge', {
    fileId: manifest.fileId,
    totalChunks: manifest.totalChunks,
    outputPath
  });

  // Sort chunks by index
  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);

  // Verify all chunks exist
  for (const chunk of sortedChunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (!existsSync(chunkPath)) {
      logger.error('Missing chunk', { filename: chunk.filename, index: chunk.index });
      throw new Error(`Missing chunk: ${chunk.filename}`);
    }
  }

  // Create output stream
  const writeStream = createWriteStream(outputPath);
  let processedBytes = 0;

  // Write chunks sequentially
  for (const chunk of sortedChunks) {
    const chunkPath = join(chunksDir, chunk.filename);

    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(chunkPath);

      readStream.on('data', (data: Buffer | string) => {
        const bufferData = typeof data === 'string' ? Buffer.from(data) : data;
        processedBytes += bufferData.length;
        if (onProgress) {
          onProgress({
            totalBytes: manifest.originalSize,
            processedBytes,
            currentChunk: chunk.index,
            totalChunks: manifest.totalChunks,
            percentage: Math.floor((processedBytes / manifest.originalSize) * 100)
          });
        }
      });

      readStream.on('end', resolve);
      readStream.on('error', reject);
      readStream.pipe(writeStream, { end: false });
    });

    logger.debug('Chunk merged', { index: chunk.index, filename: chunk.filename });
  }

  // Close write stream
  await new Promise<void>((resolve, reject) => {
    writeStream.end((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Verify final file hash
  const { verifyFile } = await import('./checksum-utils.js');
  const isValid = await verifyFile(outputPath, manifest.originalHash);

  if (!isValid) {
    logger.error('File integrity verification failed', {
      fileId: manifest.fileId,
      expectedHash: manifest.originalHash
    });
    // Remove corrupted output
    await unlink(outputPath);
    return false;
  }

  logger.info('File merge complete and verified', {
    fileId: manifest.fileId,
    outputPath,
    size: manifest.originalSize
  });

  return true;
}

/**
 * Clean up chunk files after successful merge or on failure
 */
export async function cleanupChunks(
  manifest: FileManifest,
  chunksDir: string
): Promise<void> {
  for (const chunk of manifest.chunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (existsSync(chunkPath)) {
      await unlink(chunkPath);
    }
  }

  logger.debug('Chunks cleaned up', {
    fileId: manifest.fileId,
    count: manifest.chunks.length
  });
}

/**
 * Check if file needs splitting based on size and account type
 */
export function needsSplitting(
  fileSize: number,
  isPremium: boolean = false
): boolean {
  const maxSize = isPremium
    ? 4 * 1024 * 1024 * 1024  // 4GB
    : 2 * 1024 * 1024 * 1024; // 2GB

  return fileSize > maxSize;
}
