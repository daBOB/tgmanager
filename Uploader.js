const { stat } = require("node:fs/promises"); // Add stat
const { unlink } = require("node:fs/promises"); // Change to promises version
const { basename, extname } = require("node:path");
const ffmpeg = require("fluent-ffmpeg");
const { Api } = require("telegram");
const cliProgress = require("cli-progress");
const { getSharp } = require('./utils/sharp-loader');
const logger = require('./logger');
const config = require('./config');

class Uploader {
  constructor(client) {
    this.client = client;
    this.client.on("update", (update) => {
      logger.debug('Telegram update received', { updateType: update.className });
    });
  }

  async checkPremiumStatus() {
    try {
      const result = await this.client.invoke(
        new Api.users.GetFullUser({
          id: "Me",
        })
      );
      if (!result || !result.users || result.users.length === 0) {
        logger.warn("checkPremiumStatus: Invalid result from API");
        return false;
      }
      const { premium } = result.users[0];
      if (!premium) {
        logger.debug("checkPremiumStatus: User does not have premium");
        return false;
      }
      return premium;
    } catch (error) {
      logger.error("Failed to check premium status", { error: error.message });
      return false;
    }
  }

  async getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
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
              (stream) => stream.codec_type === "video"
            );
            if (!videoStream) {
              throw new Error('No video stream found');
            }
            const { width, height, duration } = videoStream;
            resolve({ width, height, duration });
          } catch (error) {
            logger.warn('Error parsing video metadata, using defaults', { error: error.message });
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

  async uploadMP4File(chatId, filePath) {
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

      const upload = async (retryCount = 0) => {
        try {
          await this.client.sendFile(chatId, {
            file: filePath,
            caption: fileName,
            mimeType: "video/mp4",
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: duration,
                h: height,
                w: width,
                supportsStreaming: true,
              }),
            ],
            progressCallback: (e) => {
              const percentage = Number.parseInt((e.toFixed(2) * 100).toString(), 10);
              progressBar.update(percentage);
            },
          });
          return true;
        } catch (error) {
          if (error.code === 420) { // FloodWaitError
            const waitSeconds = error.seconds;
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
      const duration = Date.now() - startTime;
      logger.logUpload(fileName, chatId, fileSize, duration);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error("Failed to upload MP4 file", { 
        fileName, 
        chatId, 
        error: error.message,
        code: error.code 
      });
      return false;
    }
  }

  async uploadDocument(chatId, filePath) {
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

      const upload = async (retryCount = 0) => {
        try {
          await this.client.sendFile(chatId, {
            file: filePath,
            caption: fileName,
            progressCallback: (e) => {
              const percentage = Number.parseInt((e.toFixed(2) * 100).toString(), 10);
              progressBar.update(percentage);
            },
          });
          return true;
        } catch (error) {
          if (error.code === 420) { // FloodWaitError
            const waitSeconds = error.seconds;
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
      const duration = Date.now() - startTime;
      logger.logUpload(fileName, chatId, fileSize, duration);
      return true;
    } catch (error) {
      progressBar.stop();
      logger.error("Failed to upload document", { 
        fileName, 
        chatId, 
        error: error.message,
        code: error.code 
      });
      return false;
    }
  }

  async uploadFile(chatId, filePath) {
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
        error: error.message 
      });
      return false; // Indicate failure
    }

    if (extension === ".mp4") {
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

        // Telegram has limits on image dimensions
        const MAX_DIMENSION = config.fileProcessing.image.maxDimension;
        const MAX_COMBINED_DIMENSIONS = config.fileProcessing.image.maxCombinedDimensions;

        // Always resize large images
        if (width > MAX_DIMENSION || height > MAX_DIMENSION || (width + height) > MAX_COMBINED_DIMENSIONS) {
          // Calculate new dimensions while maintaining aspect ratio
          const aspectRatio = width / height;
          let newWidth, newHeight;

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
          error: error.message
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

module.exports = Uploader;
