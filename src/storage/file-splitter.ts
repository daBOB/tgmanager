// src/storage/file-splitter.ts
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, stat, unlink, open } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
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

const READ_BUFFER_SIZE = 1024 * 1024; // 1MB per read call
const MAX_IO_RETRIES = 5;
const IO_RETRY_DELAY_MS = 3000;

/**
 * Get chunk filename for a given file ID and index
 */
export function getChunkFilename(fileId: string, index: number): string {
  return `${fileId}-chunk-${index.toString().padStart(3, '0')}`;
}

/**
 * Read exactly `length` bytes from fd at `position` with retry on transient I/O errors.
 * Returns the number of bytes actually read (may be less at EOF).
 */
async function readWithRetry(
  fd: import('fs/promises').FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
): Promise<number> {
  for (let attempt = 1; attempt <= MAX_IO_RETRIES; attempt++) {
    try {
      const result = await fd.read(buffer, offset, length, position);
      return result.bytesRead;
    } catch (err: any) {
      const isTransient = err?.code === 'EIO' || err?.code === 'EAGAIN';
      if (isTransient && attempt < MAX_IO_RETRIES) {
        logger.warn(`I/O error at byte ${position}, retry ${attempt}/${MAX_IO_RETRIES} in ${IO_RETRY_DELAY_MS / 1000}s...`, {
          code: err.code
        });
        await new Promise(r => setTimeout(r, IO_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  return 0; // unreachable
}

/**
 * Split a large file into chunks using fd-based reads with retry.
 * Each read call retries on transient I/O errors (NFS soft mounts, flaky drives).
 * File hash and per-chunk hashes computed simultaneously — single pass, zero accumulation.
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

  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

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

  const fileHash = createHash('sha256');
  let manifest = createManifest(originalName, virtualPath, originalSize, '', chunkSize);
  const chunkPaths: string[] = [];

  const fd = await open(inputPath, 'r');
  const readBuf = Buffer.allocUnsafe(READ_BUFFER_SIZE);
  let filePosition = 0;

  try {
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const chunkFilename = getChunkFilename(manifest.fileId, chunkIdx);
      const chunkPath = join(outputDir, chunkFilename);
      const chunkHash = createHash('sha256');
      const writeStream = createWriteStream(chunkPath);
      let chunkBytesWritten = 0;
      const chunkTarget = Math.min(chunkSize, originalSize - filePosition);

      while (chunkBytesWritten < chunkTarget) {
        const toRead = Math.min(READ_BUFFER_SIZE, chunkTarget - chunkBytesWritten);
        const bytesRead = await readWithRetry(fd, readBuf, 0, toRead, filePosition);

        if (bytesRead === 0) break; // EOF

        const slice = readBuf.subarray(0, bytesRead);

        fileHash.update(slice);
        chunkHash.update(slice);

        const canContinue = writeStream.write(slice);
        if (!canContinue) {
          await new Promise<void>(resolve => writeStream.once('drain', resolve));
        }

        chunkBytesWritten += bytesRead;
        filePosition += bytesRead;

        if (onProgress) {
          onProgress({
            totalBytes: originalSize,
            processedBytes: filePosition,
            currentChunk: chunkIdx,
            totalChunks,
            percentage: Math.floor((filePosition / originalSize) * 100)
          });
        }
      }

      // Close chunk write stream
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const hash = chunkHash.digest('hex');
      manifest = addChunkToManifest(manifest, {
        index: chunkIdx,
        filename: chunkFilename,
        size: chunkBytesWritten,
        hash,
        uploaded: false
      });
      chunkPaths.push(chunkPath);

      logger.debug('Chunk written', { chunk: chunkIdx, size: chunkBytesWritten, hash });
    }
  } finally {
    await fd.close();
  }

  manifest.originalHash = fileHash.digest('hex');
  logger.debug('Original file hash calculated', { hash: manifest.originalHash });

  manifest = updateManifestStatus(manifest, 'uploading');

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

  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);

  for (const chunk of sortedChunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (!existsSync(chunkPath)) {
      logger.error('Missing chunk', { filename: chunk.filename, index: chunk.index });
      throw new Error(`Missing chunk: ${chunk.filename}`);
    }
  }

  const writeStream = createWriteStream(outputPath);
  let processedBytes = 0;

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

  await new Promise<void>((resolve, reject) => {
    writeStream.end((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const { verifyFile } = await import('./checksum-utils.js');
  const isValid = await verifyFile(outputPath, manifest.originalHash);

  if (!isValid) {
    logger.error('File integrity verification failed', {
      fileId: manifest.fileId,
      expectedHash: manifest.originalHash
    });
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
  _isPremium: boolean = false
): boolean {
  // Always split if file exceeds chunk size — Telegram rejects files near the 4GB API limit
  // even for premium accounts, so use DEFAULT_CHUNK_SIZE as the universal threshold.
  return fileSize > DEFAULT_CHUNK_SIZE;
}
