// Splits a large file into fixed-size chunks using an fd-based read loop with
// retry on transient I/O errors (NFS, flaky drives). Computes per-chunk and
// whole-file SHA-256 in a single pass.
import { createWriteStream, existsSync } from 'fs';
import { mkdir, stat, open } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { FileManifest } from './manifest-manager.js';
import {
  createManifest,
  addChunkToManifest,
  updateManifestStatus,
  saveManifest,
  DEFAULT_CHUNK_SIZE
} from './manifest-manager.js';
import logger from '../logger.js';
import { closeWriteStream } from './file-split-utils.js';

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

export function getChunkFilename(fileId: string, index: number): string {
  return `${fileId}-chunk-${index.toString().padStart(3, '0')}`;
}

// Read exactly `length` bytes from fd at `position` with retry on transient I/O errors.
// Returns the number of bytes actually read (may be less at EOF).
async function readWithRetry(
  fd: FileHandle,
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

      await closeWriteStream(writeStream);

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
