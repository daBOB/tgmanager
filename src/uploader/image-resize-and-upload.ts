import { unlink, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getSharp } from '../utils/sharp-loader.js';
import logger from '../logger.js';
import config from '../config.js';
import { computeTargetDimensions } from './image-dimension-calculator.js';

/** Performs the Telegram upload; `forceDocument` suppresses photo handling. */
type ImageUploadFn = (path: string, forceDocument: boolean) => Promise<boolean>;

/**
 * Upload `path`, choosing photo or document by file size.
 *
 * Telegram enforces a size ceiling on photos that is unrelated to dimensions,
 * and rejects anything over it with PHOTO_SAVE_FILE_INVALID. The decision is
 * made on the file actually being sent — after any resize — because resizing
 * shrinks dimensions without guaranteeing the result clears the size limit.
 */
async function sendSizedImage(path: string, uploadFn: ImageUploadFn): Promise<boolean> {
  const { size } = await stat(path);
  const forceDocument = size > config.fileProcessing.image.maxPhotoBytes;

  if (forceDocument) {
    logger.info('Image exceeds Telegram photo limit, sending as document', {
      file: basename(path),
      size,
      limit: config.fileProcessing.image.maxPhotoBytes,
    });
  }

  return uploadFn(path, forceDocument);
}

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
  uploadFn: ImageUploadFn
): Promise<boolean> {
  const sharp = await getSharp();
  if (!sharp) {
    logger.warn('Sharp not available, skipping image processing', { file: basename(filePath) });
    return sendSizedImage(filePath, uploadFn);
  }

  try {
    const { size } = await stat(filePath);
    const metadata = await sharp(filePath).metadata();
    const { width = 0, height = 0 } = metadata;

    logger.debug('Image dimensions', { width, height, file: basename(filePath) });

    if (width <= 0 || height <= 0) {
      logger.warn('Invalid image dimensions, falling back to document upload', {
        width, height, file: basename(filePath)
      });
      return sendSizedImage(filePath, uploadFn);
    }

    const image = config.fileProcessing.image;

    // Two independent reasons to shrink. Dimensions are the obvious one; size
    // is the one that bit us, because a moderately sized image can still be far
    // too many bytes to send as a photo.
    const exceedsPhotoBytes = size > image.maxPhotoBytes;
    const exceedsDimensions =
      width > image.maxDimension ||
      height > image.maxDimension ||
      (width + height) > image.maxCombinedDimensions;

    if (exceedsPhotoBytes || exceedsDimensions) {
      return resizeAndUpload(sharp, filePath, width, height, exceedsPhotoBytes, uploadFn);
    }

    logger.debug('Using original dimensions', { width, height, file: basename(filePath) });
    return sendSizedImage(filePath, uploadFn);
  } catch (error) {
    logger.error('Error processing image', {
      file: basename(filePath),
      error: (error as Error).message
    });
    logger.info('Falling back to document upload', { file: basename(filePath) });
    return sendSizedImage(filePath, uploadFn);
  }
}

/**
 * Resize an image to fit Telegram's limits and upload it. Cleans up the temp file.
 *
 * @param fitPhotoLimit - shrink hard enough to clear the photo *size* limit,
 *   not just the dimension limits. Triggers JPEG re-encoding, since re-encoding
 *   a PNG losslessly can leave it just as large.
 */
async function resizeAndUpload(
  sharp: NonNullable<Awaited<ReturnType<typeof getSharp>>>,
  filePath: string,
  width: number,
  height: number,
  fitPhotoLimit: boolean,
  uploadFn: ImageUploadFn
): Promise<boolean> {
  const image = config.fileProcessing.image;
  const { width: newWidth, height: newHeight } =
    computeTargetDimensions(width, height, image, fitPhotoLimit);

  logger.info('Resizing image', {
    original: `${width}x${height}`,
    new: `${newWidth}x${newHeight}`,
    reason: fitPhotoLimit ? 'photo size limit' : 'dimension limit',
    file: basename(filePath)
  });

  const extension = fitPhotoLimit ? '.jpg' : extname(filePath).toLowerCase();
  const resizedFilePath = `${filePath}_resized${extension}`;

  const pipeline = sharp(filePath).resize(newWidth, newHeight);
  await (fitPhotoLimit ? pipeline.jpeg({ quality: image.photoJpegQuality }) : pipeline)
    .toFile(resizedFilePath);

  try {
    // Re-checked rather than assumed: an image that still cannot fit falls back
    // to a document upload instead of failing the send.
    return await sendSizedImage(resizedFilePath, uploadFn);
  } finally {
    await unlink(resizedFilePath).catch(() => {});
  }
}
