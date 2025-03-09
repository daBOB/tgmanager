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
          reject(err);
        } else {
          const { width, height, duration } = metadata.streams.find(
            (stream) => stream.codec_type === "video"
          );
          resolve({ width, height, duration });
        }
      });
    });
  }

  async uploadMP4File(chatId, filePath) {
    const { width, height, duration } = await this.getVideoInfo(filePath);
    // console.log(width, height, duration);
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
      progressBar.start(100, 0); // Start the progress bar with a total value of 100 and starting value of 0

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
        workers: 3,
        progressCallback: (e) => {
          const percentage = Number.parseInt((e.toFixed(2) * 100).toString(), 10);
          progressBar.update(percentage); // Update the progress bar percentage
        },
      });
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
      progressBar.start(100, 0); // Start the progress bar with a total value of 100 and starting value of 0

      await this.client.sendFile(chatId, {
        file: filePath,
        caption: fileName,
        progressCallback: (e) => {
          const percentage = Number.parseInt((e.toFixed(2) * 100).toString(), 10);
          progressBar.update(percentage); // Update the progress bar percentage
        },
      });
      progressBar.stop();
      return true;
    } catch (error) {
      progressBar.stop();
      console.error("Failed to upload video:", error);
      return false;
    }
  }

  async uploadFile(chatId, filePath) {
    const extension = extname(filePath).toLowerCase();

    if (extension === ".mp4") {
      return this.uploadMP4File(chatId, filePath);
    }
    if ([".jpg", ".jpeg", ".png", ".gif"].includes(extension)) {
      try {
        // Check image dimensions
        const metadata = await sharp(filePath).metadata();
        const { width, height } = metadata;

        // Telegram has limits on image dimensions
        const MAX_DIMENSION = 10000;
        const RESIZE_RATIO = 0.5; // More aggressive resize

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          // Calculate new dimensions while maintaining aspect ratio
          const aspectRatio = width / height;
          let newWidth = width;
          let newHeight = height;

          if (width > height && width > MAX_DIMENSION) {
            newWidth = MAX_DIMENSION;
            newHeight = Math.round(MAX_DIMENSION / aspectRatio);
          } else if (height > MAX_DIMENSION) {
            newHeight = MAX_DIMENSION;
            newWidth = Math.round(MAX_DIMENSION * aspectRatio);
          }

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
