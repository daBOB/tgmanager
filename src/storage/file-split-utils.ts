// Shared helpers for chunk lifecycle: post-merge cleanup and the
// chunk-size threshold check that decides whether a file needs splitting.
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { FileManifest, DEFAULT_CHUNK_SIZE } from './manifest-manager.js';
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
// limit even for premium accounts, so DEFAULT_CHUNK_SIZE is the universal threshold.
// The `_isPremium` flag is kept for API compatibility but is unused.
export function needsSplitting(
  fileSize: number,
  _isPremium: boolean = false
): boolean {
  return fileSize > DEFAULT_CHUNK_SIZE;
}
