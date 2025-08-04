import { stat, unlink } from 'fs/promises';
import { basename, extname } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { Api } from 'telegram';
import cliProgress from 'cli-progress';
import sharp from 'sharp';
import logger, { logUpload } from './logger.js';
import config from './config.js';
import type { TelegramClient, VideoInfo, UploadOptions } from './types/index.js';

export class Uploader {
  private client: TelegramClient;

  constructor(client: TelegramClient) {
    this.client = client;
    (this.client as any).on('update', (update: Api.TypeUpdate) => {
      logger.debug('Telegram update received', { updateType: (update as any).className });
    });
  }

  async checkPremiumStatus(): Promise<boolean> {
    try {
      const result = await this.client.invoke(
        new Api.users.GetFullUser({
          id: 'Me',
        })
      );
      if (!result || !result.users || result.users.length === 0) {
        logger.warn('checkPremiumStatus: Invalid result from API');
        return false;
      }
      const user = result.users[0] as Api.User;
      if (!user.premium) {
        logger.debug('checkPremiumStatus: User does not have premium');
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Failed to check premium status', { error: (error as Error).message });
      return false;
    }
  }

  async getVideoInfo(filePath: string): Promise<VideoInfo> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          logger.warn('FFprobe error, using defaults', { error: err.message, file: basename(filePath) });
          // Return default values if FFprobe fails
          resolve({
            width: config.fileProcessing.video.defaultWidth,
            height: config.fileProcessing.video.defaultHeight,
            duration: config.fileProcessing.video.defaultDuration
          });
        } else {
          try {
            const videoStream = metadata.streams.find(
              (stream) => stream.codec_type === 'video'
            );
            if (!videoStream) {
              throw new Error('No video stream found');
            }
            const { width = 1920, height = 1080, duration = '0' } = videoStream;
            resolve({ 
              width, 
              height, 
              duration: parseFloat(duration) 
            });
          } catch (error) {
            logger.warn('Error parsing video metadata, using defaults', { error: (error as Error).message });
            // Return default values if parsing fails
            resolve({
              width: config.fileProcessing.video.defaultWidth,
              height: config.fileProcessing.video.defaultHeight,
              duration: config.fileProcessing.video.defaultDuration
            });
          }
        }
      });
    });
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
            const waitSeconds = error.seconds as number;
            const waitWithBuffer = Math.ceil(waitSeconds * config.telegram.floodWaitMultiplier);
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
            const waitSeconds = error.seconds as number;
            const waitWithBuffer = Math.ceil(waitSeconds * config.telegram.floodWaitMultiplier);
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
        // Check image dimensions
        const metadata = await sharp(filePath).metadata();
        const { width = 0, height = 0 } = metadata;
        
        logger.debug(`Image dimensions`, { width, height, file: basename(filePath) });

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
        return false;
      }
    }
    // For other file types
    return this.uploadDocument(chatId, filePath);
  }
}

export default Uploader;