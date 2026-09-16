import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Api } from 'teleproto';
import cliProgress from 'cli-progress';
import logger, { logUpload } from './logger.js';
import config from './config.js';
import { getVideoInfo } from './uploader/video-metadata-extractor.js';
import { withFloodWaitRetryAndProgress } from './uploader/flood-wait-retry-handler.js';
import { uploadImageWithResize } from './uploader/image-resize-and-upload.js';
import { checkUploadSize } from './uploader/upload-size-limit.js';
import { uploadSucceeded, uploadFailed, type UploadOutcome } from './uploader/upload-outcome.js';
import { getErrorCode } from './utils/errors.js';
import type { TelegramClient, UploadOptions } from './types/index.js';

/** The one EventEmitter method used on the client; see the constructor. */
interface UpdateEmitter {
  on(event: 'update', handler: (update: Api.TypeUpdate) => void): void;
}

export class Uploader {
  private client: TelegramClient;
  /**
   * Reports upload progress to whoever constructed this uploader.
   *
   * The progress bar only reaches the terminal of the process doing the work;
   * a queue worker uses this to persist progress so other processes can see it.
   */
  private onProgress?: (percent: number) => void;
  /** Cached premium status to avoid repeated API calls */
  private cachedPremiumStatus: boolean | null = null;

  constructor(client: TelegramClient, onProgress?: (percent: number) => void) {
    this.client = client;
    this.onProgress = onProgress;
    // teleproto is an EventEmitter at runtime but does not declare `on` in its
    // public types, which only expose addEventHandler. Cast to the narrow
    // surface actually used rather than letting `any` leak into the callback.
    (this.client as unknown as UpdateEmitter).on('update', (update) => {
      logger.debug('Telegram update received', { updateType: update.className });
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
  ): Promise<UploadOutcome> {
    const fileName = basename(filePath);
    const fileSize = (await stat(filePath)).size;
    // Explicit format: the preset's default includes `ETA: {eta}s`, and
    // cli-progress renders an uncomputable ETA as the literal "NULL" — which is
    // exactly what happens as a transfer completes. Percentage only, matching
    // the storage progress bars.
    const progressBar = new cliProgress.SingleBar(
      { format: 'Uploading |{bar}| {percentage}%', fps: 5 },
      cliProgress.Presets.shades_classic
    );

    try {
      progressBar.start(100, 0);
      await withFloodWaitRetryAndProgress(async () => {
        await this.client.sendFile(chatId, {
          file: filePath,
          caption: fileName,
          progressCallback: (e: number) => {
            const percent = Math.floor(e * 100);
            progressBar.update(percent);
            this.onProgress?.(percent);
          },
          ...extraOptions,
        });
      }, progressBar);
      progressBar.stop();
      logUpload(fileName, chatId, fileSize, Date.now() - startTime);
      return uploadSucceeded;
    } catch (error) {
      progressBar.stop();
      const detail = (error as Error).message;
      logger.error(errorMessage, {
        fileName, chatId,
        error: detail,
        code: getErrorCode(error)
      });
      // Carries the server's own words — "400: FILE_PARTS_INVALID" and the
      // like — out to the job record instead of leaving them in the log.
      return uploadFailed(`${errorMessage}: ${detail}`);
    }
  }

  async uploadMP4File(chatId: string, filePath: string): Promise<UploadOutcome> {
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

  async uploadDocument(chatId: string, filePath: string, forceDocument = false): Promise<UploadOutcome> {
    return this.sendFileWithProgress(
      chatId, filePath, Date.now(), 'Failed to upload document',
      forceDocument ? { forceDocument: true } : {}
    );
  }

  async uploadFile(chatId: string, filePath: string): Promise<UploadOutcome> {
    const isPremium = await this.checkPremiumStatus();
    const extension = extname(filePath).toLowerCase();

    try {
      const stats = await stat(filePath);

      // Rejecting here is the whole point: the same file refused by the server
      // costs the entire transfer first, which at this size is hours.
      const sizeCheck = checkUploadSize(stats.size, isPremium);
      if (!sizeCheck.ok) {
        logger.warn('Skipping file', { fileName: basename(filePath), reason: sizeCheck.reason });
        return sizeCheck;
      }
    } catch (error) {
      const detail = (error as Error).message;
      logger.error('Error getting file stats', { fileName: basename(filePath), error: detail });
      return uploadFailed(`Cannot read file: ${detail}`);
    }

    if (extension === '.mp4') {
      return this.uploadMP4File(chatId, filePath);
    }

    if (config.fileProcessing.image.supportedFormats.includes(extension)) {
      // The resize path reports success as a boolean and logs its own reasons,
      // so the detail stops here rather than being invented.
      const sent = await uploadImageWithResize(filePath, (path, forceDocument) =>
        this.uploadDocument(chatId, path, forceDocument).then(outcome => outcome.ok));

      return sent ? uploadSucceeded : uploadFailed('Image upload failed (see log for detail)');
    }

    return this.uploadDocument(chatId, filePath);
  }
}

export default Uploader;
