import { rmdirSync, statSync } from 'node:fs';
import logger from '../logger.js';
import { getErrorCode } from '../utils/errors.js';

/**
 * Remove the source directory once `--delete-source` has emptied it.
 *
 * Per-file deletion happens in the worker, so "every file uploaded" is the same
 * question as "is the directory empty". rmdir answers it atomically: it removes
 * an empty directory and refuses a non-empty one, so nothing needs to count
 * failures, and a file still queued for another worker protects its directory
 * on its own.
 *
 * rmdir specifically, not rm: `rmSync(path, { recursive: false })` fails with
 * EISDIR on *any* directory, empty or not, so it could never delete one.
 */
export function removeEmptySourceDirectory(uploadPath: string): void {
  try {
    if (!statSync(uploadPath).isDirectory()) return;
  } catch {
    // Already gone, or never existed — nothing to clean up either way.
    return;
  }

  try {
    rmdirSync(uploadPath);
    logger.info('Deleted source directory', { path: uploadPath });
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      logger.info('Source directory kept: files remain', { path: uploadPath });
      return;
    }
    logger.warn('Could not remove source directory', {
      path: uploadPath,
      error: (error as Error).message,
    });
  }
}
