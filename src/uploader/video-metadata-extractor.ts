import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../logger.js';
import config from '../config.js';
import type { VideoInfo } from '../types/index.js';

const execFileAsync = promisify(execFile);

/**
 * Extract video metadata (width, height, duration) via FFprobe.
 * Falls back to config defaults on any error.
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const defaults: VideoInfo = {
    width: config.fileProcessing.video.defaultWidth,
    height: config.fileProcessing.video.defaultHeight,
    duration: config.fileProcessing.video.defaultDuration
  };

  try {
    // execFile with array args prevents command injection; 30s timeout prevents hangs
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
      { timeout: 30000 }
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> } = JSON.parse(stdout);
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');

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
