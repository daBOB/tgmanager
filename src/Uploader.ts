import { stat } from 'fs/promises';
import { basename, extname } from 'path';
import { Api } from 'telegram';
import cliProgress from 'cli-progress';
import logger, { logUpload } from './logger.js';
import config from './config.js';
import { getVideoInfo } from './uploader/video-metadata-extractor.js';
import { withFloodWaitRetry } from './uploader/flood-wait-retry-handler.js';
import { uploadImageWithResize } from './uploader/image-resize-and-upload.js';
import type { TelegramClient, UploadOptions } from './types/index.js';

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
   * Result is cached for the lifetime of this Uploader instance.
   */
  async checkPremiumStatus(): Promise<boolean> {
    if (this.cachedPremiumStatus !== null) {
      logger.debug('checkPremiumStatus: Using cached value', { isPremium: this.cachedPremiumStatus });
      return this.cachedPremiumStatus;
    }

    try {
      const result = await this.client.invoke(new Api.users.GetFullUser({ id: 'Me' }));
      if (!result?.users?.length) {
        logger.warn('checkPremiumStatus: Invalid result from API');
        this.cachedPremiumStatus = false;
        return false;
      }
      const user = result.users[0] as Api.User;
      const isPremium = !!user.premium;
      this.cachedPremiumStatus = isPremium;
      logger.debug(isPremium ? 'checkPremiumStatus: User has premium status' : 'checkPremiumStatus: User does not have premium');
      return isPremium;
    } catch (error) {
      logger.error('Failed to check premium status', { error: (error as Error).message });
      this.cachedPremiumStatus = false;
      return false;
    }
  }

  async uploadMP4File(chatId: string, filePath: string): Promise<boolean> {
    const startTime = Date.now();
    const { width, height, duration } = await getVideoInfo(filePath);
    const fileName = basename(filePath);
    const fileSize = (await stat(filePath)).size;
    const progressBar = new cliProgress.SingleBar(
      { etaAsynchronousUpdate: true, etaBuffer: 40, fps: 5 },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);
      await withFloodWaitRetry(async () => {
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
          progressCallback: (e: number) => progressBar.update(Math.floor(e * 100)),
        } as UploadOptions);
      }, progressBar);
      progressBar.stop();
      logUpload(fileName, chatId, fileSize, Date.now() - startTime);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error('Failed to upload MP4 file', {
        fileName, chatId,
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
      { etaAsynchronousUpdate: true, etaBuffer: 40, fps: 5 },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);
      await withFloodWaitRetry(async () => {
        await this.client.sendFile(chatId, {
          file: filePath,
          caption: fileName,
          progressCallback: (e: number) => progressBar.update(Math.floor(e * 100)),
        });
      }, progressBar);
      progressBar.stop();
      logUpload(fileName, chatId, fileSize, Date.now() - startTime);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error('Failed to upload document', {
        fileName, chatId,
        error: (error as Error).message,
        code: (error as any).code
      });
      return false;
    }
  }

  async uploadFile(chatId: string, filePath: string): Promise<boolean> {
    const isPremium = await this.checkPremiumStatus();
    const MAX_FILE_SIZE_BYTES = isPremium
      ? config.fileProcessing.premium.maxFileSizeBytes
      : config.fileProcessing.regular.maxFileSizeBytes;
    const extension = extname(filePath).toLowerCase();

    try {
      const stats = await stat(filePath);

      if (stats.size === 0) {
        logger.warn('Skipping empty file', { fileName: basename(filePath) });
        return false;
      }

      if (stats.size > MAX_FILE_SIZE_BYTES) {
        const limitGB = MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024);
        logger.warn('Skipping large file', {
          fileName: basename(filePath),
          fileSize: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
          limit: `${limitGB} GB`,
          accountType: isPremium ? 'premium' : 'regular'
        });
        return false;
      }
    } catch (error) {
      logger.error('Error getting file stats', {
        fileName: basename(filePath),
        error: (error as Error).message
      });
      return false;
    }

    if (extension === '.mp4') {
      return this.uploadMP4File(chatId, filePath);
    }

    if (config.fileProcessing.image.supportedFormats.includes(extension)) {
      return uploadImageWithResize(filePath, (path) => this.uploadDocument(chatId, path));
    }

    return this.uploadDocument(chatId, filePath);
  }
}

export default Uploader;
