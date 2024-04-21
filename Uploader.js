const fs = require("fs");
const { basename, extname } = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { Api } = require("telegram");
const cliProgress = require("cli-progress");
class Uploader {
  constructor(client) {
    this.client = client;
    this.client.on("update", (update) => {
      //console.log('Got update:', update)
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
          const percentage = parseInt(e.toFixed(2) * 100);
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
          const percentage = parseInt(e.toFixed(2) * 100);
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
    // Read file contents
    //const file = fs.createReadStream(filePath);
    const extension = extname(filePath).toLowerCase();

    if (extension === ".mp4") {
      return this.uploadMP4File(chatId, filePath);
    } else {
	  return this.uploadDocument(chatId, filePath);
	}
  }
}

module.exports = Uploader;
