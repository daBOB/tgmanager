import { unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getSharp } from '../utils/sharp-loader.js';
import logger from '../logger.js';
import config from '../config.js';

/**
 * Handle image upload: check dimensions, resize if needed, then call uploadFn.
 * Falls back to uploadFn with original path if sharp is unavailable or on error.
 *
 * @param filePath - absolute path to the image file
 * @param uploadFn - callback that performs the actual Telegram upload
 * @returns result of uploadFn
 */
export async function uploadImageWithResize(
  filePath: string,
  uploadFn: (path: string) => Promise<boolean>
): Promise<boolean> {
  const sharp = await getSharp();
  if (!sharp) {
    logger.warn('Sharp not available, skipping image processing', { file: basename(filePath) });
    return uploadFn(filePath);
  }

  try {
    const metadata = await sharp(filePath).metadata();
    const { width = 0, height = 0 } = metadata;

    logger.debug('Image dimensions', { width, height, file: basename(filePath) });

    if (width <= 0 || height <= 0) {
      logger.warn('Invalid image dimensions, falling back to document upload', {
        width, height, file: basename(filePath)
      });
      return uploadFn(filePath);
    }

    const MAX_DIMENSION = config.fileProcessing.image.maxDimension;
    const MAX_COMBINED = config.fileProcessing.image.maxCombinedDimensions;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION || (width + height) > MAX_COMBINED) {
      return resizeAndUpload(sharp, filePath, width, height, uploadFn);
    }

    logger.debug('Using original dimensions', { width, height, file: basename(filePath) });
    return uploadFn(filePath);
  } catch (error) {
    logger.error('Error processing image', {
      file: basename(filePath),
      error: (error as Error).message
    });
    logger.info('Falling back to document upload', { file: basename(filePath) });
    return uploadFn(filePath);
  }
}

/** Resize image to fit within Telegram dimension limits and upload. Cleans up temp file. */
async function resizeAndUpload(
  sharp: NonNullable<Awaited<ReturnType<typeof getSharp>>>,
  filePath: string,
  width: number,
  height: number,
  uploadFn: (path: string) => Promise<boolean>
): Promise<boolean> {
  const MAX_DIMENSION = config.fileProcessing.image.maxDimension;
  const MAX_COMBINED = config.fileProcessing.image.maxCombinedDimensions;
  const aspectRatio = width / height;

  // Fit within combined and per-axis limits while preserving aspect ratio
  let newWidth = Math.min(Math.sqrt(MAX_COMBINED * aspectRatio), MAX_DIMENSION);
  let newHeight = newWidth / aspectRatio;

  if (newHeight > MAX_DIMENSION) {
    newHeight = MAX_DIMENSION;
    newWidth = newHeight * aspectRatio;
  }

  newWidth = Math.floor(newWidth);
  newHeight = Math.floor(newHeight);

  logger.info('Resizing image', {
    original: `${width}x${height}`,
    new: `${newWidth}x${newHeight}`,
    file: basename(filePath)
  });

  const extension = extname(filePath).toLowerCase();
  const resizedFilePath = `${filePath}_resized${extension}`;
  await sharp(filePath).resize(newWidth, newHeight).toFile(resizedFilePath);

  try {
    return await uploadFn(resizedFilePath);
  } finally {
    await unlink(resizedFilePath).catch(() => {});
  }
}
