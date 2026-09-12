// Merges chunks produced by file-chunk-splitter back into the original file
// and verifies the resulting file's SHA-256 against the manifest's expected hash.
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileManifest } from './manifest-manager.js';
import type { SplitProgress } from './file-chunk-splitter.js';
import logger from '../logger.js';
import { closeWriteStream } from './file-split-utils.js';

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

  await closeWriteStream(writeStream);

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
