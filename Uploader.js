const { stat } = require("node:fs/promises"); // Add stat
const { unlink } = require("node:fs/promises"); // Change to promises version
const { basename, extname } = require("node:path");
const ffmpeg = require("fluent-ffmpeg");
const { Api } = require("telegram");
const cliProgress = require("cli-progress");
const sharp = require('sharp');

class Uploader {
  constructor(client) {
    this.client = client;
    this.client.on("update", (update) => {
      console.log('Got update:', update)
    });
  }

  async getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error('FFprobe error:', err.message);
          // Return default values if FFprobe fails
          resolve({
            width: 1920,  // default HD width
            height: 1080, // default HD height
            duration: 0   // default duration
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
            console.error('Error parsing video metadata:', error.message);
            // Return default values if parsing fails
            resolve({
              width: 1920,
              height: 1080,
              duration: 0
            });
          }
        }
      });
    });
  }

  async uploadMP4File(chatId, filePath) {
    const { width, height, duration } = await this.getVideoInfo(filePath);
    const fileName = basename(filePath);
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
            console.log(`\nFlood wait error. Waiting ${waitSeconds} seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            return upload(retryCount + 1);
          }
          throw error; // Re-throw other errors
        }
      };

      await upload();
      progressBar.stop();
      return true;
    } catch (error) {
      progressBar.stop();
      console.error("Failed to upload document:", error);
      return false;
    }
  }

  async uploadDocument(chatId, filePath) {
    const fileName = basename(filePath);
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
            console.log(`\nFlood wait error. Waiting ${waitSeconds} seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            return upload(retryCount + 1);
          }
          throw error; // Re-throw other errors
        }
      };

      await upload();
      progressBar.stop();
      return true;
    } catch (error) {
      progressBar.stop();
      console.error("Failed to upload video:", error);
      return false;
    }
  }

  async uploadFile(chatId, filePath) {
  const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB limit

    const extension = extname(filePath).toLowerCase();

    try {
      const stats = await stat(filePath);
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        console.log(`\nSkipping large file (over ${MAX_FILE_SIZE_BYTES / (1024*1024*1024)}GB): ${basename(filePath)}`);
        return false; // Indicate skip/failure
      }
    } catch (error) {
      console.error(`\nError getting file stats for ${basename(filePath)}:`, error.message);
      return false; // Indicate failure
    }

    if (extension === ".mp4") {
      return this.uploadMP4File(chatId, filePath);
    }
    if ([".jpg", ".jpeg", ".png", ".gif"].includes(extension)) {
      try {
        // Check image dimensions
        const metadata = await sharp(filePath).metadata();
        const { width, height } = metadata;
        
        console.log(`Original dimensions: ${width}x${height}`);

        // Telegram has limits on image dimensions
        const MAX_DIMENSION = 5000; // Reduced from 10000 to be safer
        const MAX_COMBINED_DIMENSIONS = 9000; // Reduced from 10000 to be safer

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

          console.log(`Resizing to: ${newWidth}x${newHeight}`);

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
        
        console.log(`Using original dimensions: ${width}x${height}`);
        return this.uploadDocument(chatId, filePath);
      } catch (error) {
        console.error('Error processing image:', error);
        return false;
      }
    }
    // For other file types
    return this.uploadDocument(chatId, filePath);
  }
}

module.exports = Uploader;
