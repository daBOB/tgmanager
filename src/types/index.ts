import type { Api, TelegramClient } from 'telegram';
import type { StoreSession } from 'telegram/sessions/index.js';

export interface AccountConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  password?: string;
}

export interface AppConfig {
  logLevel: string;
  maxConcurrentUploads: number;
  uploadTimeout: number;
  sessionDir: string;
  uploadDir: string;
}

export interface TelegramConfig {
  connectionRetries: number;
  useWSS: boolean;
  floodWaitMultiplier: number;
}

export interface ImageProcessingConfig {
  maxDimension: number;
  maxCombinedDimensions: number;
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
}

export interface CommandOptions {
  account?: string;
  command?: string;
  chatId?: string;
  filePath?: string;
  deleteSource?: boolean;
  name?: string;
  virtualPath?: string;
  outputPath?: string;
  storageChannel?: string;
  force?: boolean;
  wait?: boolean;
}

// Re-export types from dependencies for convenience
export type { Api, TelegramClient, StoreSession };