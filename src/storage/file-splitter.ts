// src/storage/file-splitter.ts
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';
import { Transform, TransformCallback } from 'stream';
import {
  FileManifest,
  ChunkInfo,
  createManifest,
  addChunkToManifest,
  updateManifestStatus,
  saveManifest,
  DEFAULT_CHUNK_SIZE
} from './manifest-manager.js';
import { hashFile, hashChunk } from './checksum-utils.js';
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
 * Split a large file into chunks using streams (memory efficient)
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

  // Get file stats and hash
  const stats = await stat(inputPath);
  const originalSize = stats.size;
  const originalName = basename(inputPath);

  logger.info('Starting file split', {
    file: originalName,
    size: originalSize,
    chunkSize
  });

  // Calculate original file hash
  const { hash: originalHash } = await hashFile(inputPath);
  logger.debug('Original file hash calculated', { hash: originalHash });

  // Create manifest
  let manifest = createManifest(
    originalName,
    virtualPath,
    originalSize,
    originalHash,
    chunkSize
  );

  const chunkPaths: string[] = [];
  let currentChunk = 0;
  let processedBytes = 0;
  let currentChunkSize = 0;
  let currentChunkData: Buffer[] = [];

  const writeChunk = async (): Promise<void> => {
    if (currentChunkData.length === 0) return;

    const chunkBuffer = Buffer.concat(currentChunkData);
    const chunkFilename = getChunkFilename(manifest.fileId, currentChunk);
    const chunkPath = join(outputDir, chunkFilename);

    // Write chunk to file
    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(chunkPath);
      writeStream.write(chunkBuffer, (err) => {
        if (err) reject(err);
        writeStream.end(() => resolve());
      });
    });

    // Calculate chunk hash
    const chunkHash = hashChunk(chunkBuffer);

    // Add chunk info to manifest
    const chunkInfo: Omit<ChunkInfo, 'uploadedAt'> = {
      index: currentChunk,
      filename: chunkFilename,
      size: chunkBuffer.length,
      hash: chunkHash,
      uploaded: false
    };

    manifest = addChunkToManifest(manifest, chunkInfo);
    chunkPaths.push(chunkPath);

    logger.debug('Chunk written', {
      chunk: currentChunk,
      size: chunkBuffer.length,
      hash: chunkHash
    });

    // Reset for next chunk
    currentChunkData = [];
    currentChunkSize = 0;
    currentChunk++;
  };

  // Create transform stream for chunking
  const chunker = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      let offset = 0;

      const processChunk = async () => {
        while (offset < chunk.length) {
          const remainingInChunk = chunkSize - currentChunkSize;
          const bytesToCopy = Math.min(remainingInChunk, chunk.length - offset);

          currentChunkData.push(chunk.subarray(offset, offset + bytesToCopy));
          currentChunkSize += bytesToCopy;
          processedBytes += bytesToCopy;
          offset += bytesToCopy;

          // Report progress
          if (onProgress) {
            onProgress({
              totalBytes: originalSize,
              processedBytes,
              currentChunk,
              totalChunks: manifest.totalChunks,
              percentage: Math.floor((processedBytes / originalSize) * 100)
            });
          }

          // Chunk is full, write it
          if (currentChunkSize >= chunkSize) {
            await writeChunk();
          }
        }
      };

      processChunk()
        .then(() => callback())
        .catch(callback);
    },

    async flush(callback: TransformCallback) {
      // Write any remaining data as final chunk
      try {
        await writeChunk();
        callback();
      } catch (err) {
        callback(err as Error);
      }
    }
  });

  // Process the file
  const readStream = createReadStream(inputPath, { highWaterMark: 64 * 1024 });

  await pipeline(readStream, chunker);

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
