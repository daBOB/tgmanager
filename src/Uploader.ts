import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Api } from 'telegram';
import cliProgress from 'cli-progress';
import logger, { logUpload } from './logger.js';
import config from './config.js';
import { getVideoInfo } from './uploader/video-metadata-extractor.js';
import { withFloodWaitRetryAndProgress } from './uploader/flood-wait-retry-handler.js';
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

  /**
   * Shared send path for every file type: progress-bar lifecycle, flood-wait
   * retry, success logging and failure handling are identical, so only the
   * type-specific send options and the error label vary.
   *
   * `startTime` is passed in so the reported duration covers any preparation
   * the caller did (video probing) rather than the send alone.
   *
   * `extraOptions` cannot carry `file`, `caption` or `progressCallback`: it is
   * spread last, so allowing them would let a caller silently detach the
   * progress bar.
   */
  private async sendFileWithProgress(
    chatId: string,
    filePath: string,
    startTime: number,
    errorMessage: string,
    extraOptions: Partial<Omit<UploadOptions, 'file' | 'caption' | 'progressCallback'>> = {}
  ): Promise<boolean> {
    const fileName = basename(filePath);
    const fileSize = (await stat(filePath)).size;
    const progressBar = new cliProgress.SingleBar(
      { etaAsynchronousUpdate: true, etaBuffer: 40, fps: 5 },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);
      await withFloodWaitRetryAndProgress(async () => {
        await this.client.sendFile(chatId, {
          file: filePath,
          caption: fileName,
          progressCallback: (e: number) => progressBar.update(Math.floor(e * 100)),
          ...extraOptions,
        });
      }, progressBar);
      progressBar.stop();
      logUpload(fileName, chatId, fileSize, Date.now() - startTime);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error(errorMessage, {
        fileName, chatId,
        error: (error as Error).message,
        code: (error as any).code
      });
      return false;
    }
  }

  async uploadMP4File(chatId: string, filePath: string): Promise<boolean> {
    const startTime = Date.now();
    const { width, height, duration } = await getVideoInfo(filePath);

    return this.sendFileWithProgress(chatId, filePath, startTime, 'Failed to upload MP4 file', {
      mimeType: 'video/mp4',
      attributes: [
        new Api.DocumentAttributeVideo({
          duration: Math.round(duration),
          h: height,
          w: width,
          supportsStreaming: true,
        }),
      ],
    });
  }

  async uploadDocument(chatId: string, filePath: string): Promise<boolean> {
    return this.sendFileWithProgress(chatId, filePath, Date.now(), 'Failed to upload document');
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
