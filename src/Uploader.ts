import { stat, unlink } from 'fs/promises';
import { basename, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Api } from 'telegram';
import cliProgress from 'cli-progress';
import { getSharp } from './utils/sharp-loader.js';
import logger, { logUpload } from './logger.js';
import config from './config.js';
import type { TelegramClient, VideoInfo, UploadOptions } from './types/index.js';

const execFileAsync = promisify(execFile);

export class Uploader {
  private client: TelegramClient;
  /** Cached premium status to avoid repeated API calls */
  private cachedPremiumStatus: boolean | null = null;

  constructor(client: TelegramClient) {
    this.client = client;
    (this.client as any).on('update', (update: Api.TypeUpdate) => {
      logger.debug('Telegram update received', { updateType: (update as any).className });
    });
  }

  /**
   * Check if user has Telegram Premium status.
   * Result is cached for the lifetime of this Uploader instance to avoid repeated API calls.
   */
  async checkPremiumStatus(): Promise<boolean> {
    // Return cached value if available
    if (this.cachedPremiumStatus !== null) {
      logger.debug('checkPremiumStatus: Using cached value', { isPremium: this.cachedPremiumStatus });
      return this.cachedPremiumStatus;
    }

    try {
      const result = await this.client.invoke(
        new Api.users.GetFullUser({
          id: 'Me',
        })
      );
      if (!result || !result.users || result.users.length === 0) {
        logger.warn('checkPremiumStatus: Invalid result from API');
        this.cachedPremiumStatus = false;
        return false;
      }
      const user = result.users[0] as Api.User;
      const isPremium = !!user.premium;
      this.cachedPremiumStatus = isPremium;

      if (!isPremium) {
        logger.debug('checkPremiumStatus: User does not have premium');
      } else {
        logger.debug('checkPremiumStatus: User has premium status');
      }
      return isPremium;
    } catch (error) {
      logger.error('Failed to check premium status', { error: (error as Error).message });
      this.cachedPremiumStatus = false;
      return false;
    }
  }

  /**
   * Extract video metadata using FFprobe.
   * Uses async execFile to avoid blocking the event loop and prevent command injection.
   */
  async getVideoInfo(filePath: string): Promise<VideoInfo> {
    const defaults: VideoInfo = {
      width: config.fileProcessing.video.defaultWidth,
      height: config.fileProcessing.video.defaultHeight,
      duration: config.fileProcessing.video.defaultDuration
    };

    try {
      // Use execFile with array arguments to prevent command injection
      // Add 30 second timeout to prevent hanging
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
        { timeout: 30000 }
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const data: { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> } = JSON.parse(stdout);
      const videoStream = data.streams?.find((stream) => stream.codec_type === 'video');

      if (!videoStream) {
        logger.warn('No video stream found, using defaults', { file: basename(filePath) });
        return defaults;
      }

      const width = videoStream.width ?? defaults.width;
      const height = videoStream.height ?? defaults.height;
      const duration = parseFloat(videoStream.duration ?? '0') || defaults.duration;

      logger.debug('Video metadata extracted', { width, height, duration, file: basename(filePath) });
      return { width, height, duration };
    } catch (error) {
      logger.warn('FFprobe error, using defaults', {
        error: (error as Error).message,
        file: basename(filePath)
      });
      return defaults;
    }
  }

  async uploadMP4File(chatId: string, filePath: string): Promise<boolean> {
    const startTime = Date.now();
    const { width, height, duration } = await this.getVideoInfo(filePath);
    const fileName = basename(filePath);
    const fileSize = (await stat(filePath)).size;
    const progressBar = new cliProgress.SingleBar(
      {
        etaAsynchronousUpdate: true,
        etaBuffer: 40,
        fps: 5,
      },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);

      const upload = async (retryCount = 0): Promise<boolean> => {
        try {
          await this.client.sendFile(chatId, {
            file: filePath,
            caption: fileName,
            mimeType: 'video/mp4',
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: Math.round(duration),
                h: height,
                w: width,
                supportsStreaming: true,
              }),
            ],
            progressCallback: (e: number) => {
              const percentage = Math.floor(e * 100);
              progressBar.update(percentage);
            },
          } as UploadOptions);
          return true;
        } catch (error: any) {
          if (error.code === 420) { // FloodWaitError
            // Check max retry limit
            if (retryCount >= 10) {
              logger.error('Max flood wait retries exceeded', { retryCount });
              throw new Error('Max flood wait retries exceeded');
            }

            // Add fallback for undefined seconds and ensure minimum 1 second wait
            const waitSeconds = error.seconds ?? 60;
            const waitWithBuffer = Math.max(1, Math.ceil(waitSeconds * config.telegram.floodWaitMultiplier));
            logger.warn(`Flood wait error. Waiting ${waitWithBuffer} seconds before retry`, {
              originalWait: waitSeconds,
              actualWait: waitWithBuffer,
              retryCount
            });
            progressBar.stop();
            await new Promise(resolve => setTimeout(resolve, waitWithBuffer * 1000));
            progressBar.start(100, 0);
            return upload(retryCount + 1);
          }
          throw error; // Re-throw other errors
        }
      };

      await upload();
      progressBar.stop();
      const uploadDuration = Date.now() - startTime;
      logUpload(fileName, chatId, fileSize, uploadDuration);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error('Failed to upload MP4 file', { 
        fileName, 
        chatId, 
        error: (error as Error).message,
        code: (error as any).code 
      });
      return false;
    }
  }

  async uploadDocument(chatId: string, filePath: string): Promise<boolean> {
    const startTime = Date.now();
    const fileName = basename(filePath);
    const fileSize = (await stat(filePath)).size;
    const progressBar = new cliProgress.SingleBar(
      {
        etaAsynchronousUpdate: true,
        etaBuffer: 40,
        fps: 5,
      },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);

      const upload = async (retryCount = 0): Promise<boolean> => {
        try {
          await this.client.sendFile(chatId, {
            file: filePath,
            caption: fileName,
            progressCallback: (e: number) => {
              const percentage = Math.floor(e * 100);
              progressBar.update(percentage);
            },
          });
          return true;
        } catch (error: any) {
          if (error.code === 420) { // FloodWaitError
            // Check max retry limit
            if (retryCount >= 10) {
              logger.error('Max flood wait retries exceeded', { retryCount });
              throw new Error('Max flood wait retries exceeded');
            }

            // Add fallback for undefined seconds and ensure minimum 1 second wait
            const waitSeconds = error.seconds ?? 60;
            const waitWithBuffer = Math.max(1, Math.ceil(waitSeconds * config.telegram.floodWaitMultiplier));
            logger.warn(`Flood wait error. Waiting ${waitWithBuffer} seconds before retry`, {
              originalWait: waitSeconds,
              actualWait: waitWithBuffer,
              retryCount
            });
            progressBar.stop();
            await new Promise(resolve => setTimeout(resolve, waitWithBuffer * 1000));
            progressBar.start(100, 0);
            return upload(retryCount + 1);
          }
          throw error; // Re-throw other errors
        }
      };

      await upload();
      progressBar.stop();
      const uploadDuration = Date.now() - startTime;
      logUpload(fileName, chatId, fileSize, uploadDuration);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error('Failed to upload document', { 
        fileName, 
        chatId, 
        error: (error as Error).message,
        code: (error as any).code 
      });
      return false;
    }
  }

  async uploadFile(chatId: string, filePath: string): Promise<boolean> {
    // Check if account has premium status
    const isPremium = await this.checkPremiumStatus();
    const MAX_FILE_SIZE_BYTES = isPremium
      ? config.fileProcessing.premium.maxFileSizeBytes
      : config.fileProcessing.regular.maxFileSizeBytes;

    const extension = extname(filePath).toLowerCase();

    try {
      const stats = await stat(filePath);
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        const limitGB = MAX_FILE_SIZE_BYTES / (1024*1024*1024);
        const accountType = isPremium ? 'premium' : 'regular';
        logger.warn(`Skipping large file`, {
          fileName: basename(filePath),
          fileSize: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
          limit: `${limitGB} GB`,
          accountType
        });
        return false; // Indicate skip/failure
      }
    } catch (error) {
      logger.error(`Error getting file stats`, { 
        fileName: basename(filePath), 
        error: (error as Error).message 
      });
      return false; // Indicate failure
    }

    if (extension === '.mp4') {
      return this.uploadMP4File(chatId, filePath);
    }
    if (config.fileProcessing.image.supportedFormats.includes(extension)) {
      try {
        // Load sharp using the robust loader
        const sharp = await getSharp();
        if (!sharp) {
          logger.warn('Sharp not available, skipping image processing', {
            file: basename(filePath)
          });
          // Fall back to regular document upload without processing
          return await this.uploadDocument(chatId, filePath);
        }

        // Check image dimensions
        const metadata = await sharp(filePath).metadata();
        const { width = 0, height = 0 } = metadata;

        logger.debug(`Image dimensions`, { width, height, file: basename(filePath) });

        // Validate dimensions before processing to prevent division by zero
        if (width <= 0 || height <= 0) {
          logger.warn('Invalid image dimensions, falling back to document upload', {
            width,
            height,
            file: basename(filePath)
          });
          return await this.uploadDocument(chatId, filePath);
        }

        // Telegram has limits on image dimensions
        const MAX_DIMENSION = config.fileProcessing.image.maxDimension;
        const MAX_COMBINED_DIMENSIONS = config.fileProcessing.image.maxCombinedDimensions;

        // Always resize large images
        if (width > MAX_DIMENSION || height > MAX_DIMENSION || (width + height) > MAX_COMBINED_DIMENSIONS) {
          // Calculate new dimensions while maintaining aspect ratio
          const aspectRatio = width / height;
          let newWidth: number, newHeight: number;

          // Calculate dimensions based on combined limit
          newWidth = Math.min(Math.sqrt(MAX_COMBINED_DIMENSIONS * aspectRatio), MAX_DIMENSION);
          newHeight = newWidth / aspectRatio;

          // Ensure height is also within limits
          if (newHeight > MAX_DIMENSION) {
            newHeight = MAX_DIMENSION;
            newWidth = newHeight * aspectRatio;
          }

          // Round the dimensions
          newWidth = Math.floor(newWidth);
          newHeight = Math.floor(newHeight);

          logger.info(`Resizing image`, { 
            original: `${width}x${height}`, 
            new: `${newWidth}x${newHeight}`,
            file: basename(filePath)
          });

          // Reduce image size
          const resizedFilePath = `${filePath}_resized${extension}`;
          await sharp(filePath)
            .resize(newWidth, newHeight)
            .toFile(resizedFilePath);

          // Upload the resized image
          const success = await this.uploadDocument(chatId, resizedFilePath);

          // Delete the resized image file
          await unlink(resizedFilePath);

          return success;
        }
        
        logger.debug(`Using original dimensions`, { width, height, file: basename(filePath) });
        return this.uploadDocument(chatId, filePath);
      } catch (error) {
        logger.error('Error processing image', {
          file: basename(filePath),
          error: (error as Error).message
        });
        // Fall back to regular document upload if image processing fails
        logger.info('Falling back to document upload', { file: basename(filePath) });
        return await this.uploadDocument(chatId, filePath);
      }
    }
    // For other file types
    return this.uploadDocument(chatId, filePath);
  }
}

export default Uploader;