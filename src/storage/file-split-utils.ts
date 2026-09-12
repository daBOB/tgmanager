// Shared helpers for chunk lifecycle: stream teardown, post-merge cleanup and
// the chunk-size threshold check that decides whether a file needs splitting.
import { existsSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileManifest} from './manifest-manager.js';
import { DEFAULT_CHUNK_SIZE } from './manifest-manager.js';
import logger from '../logger.js';

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

// Always split if file exceeds chunk size. Telegram rejects files near the 4GB API
// limit even for premium accounts, so DEFAULT_CHUNK_SIZE is the universal threshold
// and account type is deliberately not an input.
export function needsSplitting(fileSize: number): boolean {
  return fileSize > DEFAULT_CHUNK_SIZE;
}

/**
 * Close a write stream and wait for the flush to finish.
 *
 * `end()` reports late write errors through its callback, so the promise must
 * reject on them: resolving early would let a truncated chunk look successful.
 */
export function closeWriteStream(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
