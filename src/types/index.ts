import type { Api, TelegramClient } from 'teleproto';
import type { StoreSession } from 'teleproto/sessions/index.js';

export interface AccountConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  password?: string;
}

export interface AppConfig {
  logLevel: string;
  sessionDir: string;
  uploadDir: string;
}

export interface TelegramConfig {
  connectionRetries: number;
  floodWaitMultiplier: number;
}

export interface ImageProcessingConfig {
  maxDimension: number;
  maxCombinedDimensions: number;
  /** Largest file Telegram accepts as a photo; above this the image is shrunk. */
  maxPhotoBytes: number;
  /** Longest side to downscale to when shrinking an image to fit the photo limit. */
  photoMaxDimension: number;
  /** JPEG quality used when re-encoding an image to fit the photo limit. */
  photoJpegQuality: number;
  supportedFormats: string[];
}

export interface VideoProcessingConfig {
  defaultWidth: number;
  defaultHeight: number;
  defaultDuration: number;
}

export interface FileSizeConfig {
  maxFileSizeBytes: number;
}

export interface FileProcessingConfig {
  image: ImageProcessingConfig;
  video: VideoProcessingConfig;
  premium: FileSizeConfig;
  regular: FileSizeConfig;
}

export interface Config {
  accounts: Record<string, AccountConfig>;
  app: AppConfig;
  telegram: TelegramConfig;
  fileProcessing: FileProcessingConfig;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

export interface UploadOptions {
  file: string;
  caption?: string;
  mimeType?: string;
  attributes?: Api.TypeDocumentAttribute[];
  progressCallback?: (progress: number) => void;
  /** Send as a file rather than letting the client infer photo/video from the extension. */
  forceDocument?: boolean;
}

export interface CommandOptions {
  account?: string;
  command?: string;
  chatId?: string;
  filePath?: string;
  deleteSource?: boolean;
  name?: string;
  priority?: number;
  at?: string;
  status?: string;
  limit?: number;
  virtualPath?: string;
  outputPath?: string;
  storageChannel?: string;
  force?: boolean;
  wait?: boolean;
}

// Re-export types from dependencies for convenience
export type { Api, TelegramClient, StoreSession };