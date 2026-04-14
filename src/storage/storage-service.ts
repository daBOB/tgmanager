// src/storage/storage-service.ts
// Thin facade: StorageService class delegates to focused modules.
// Re-exports the full public surface so all existing import sites work unchanged.

import type { TelegramClient } from '../types/index.js';
import type { FileManifest } from './manifest-manager.js';
import {
  StorageServiceConfig,
  DEFAULT_CONFIG,
  initializeStorageChannel,
  requireChannelId
} from './storage-channel-manager.js';
import {
  UploadProgress,
  uploadChunk,
  uploadAllChunks,
  uploadManifest
} from './storage-file-uploader.js';
import {
  downloadChunk,
  getManifestFromMessage,
  deleteStoredFile
} from './storage-file-downloader.js';
import {
  StoredFileInfo,
  listStoredFiles,
  listByPath,
  findByPath,
  findByHash
} from './storage-file-finder.js';

export type { StoredFileInfo, UploadProgress, StorageServiceConfig };

/** Storage service for managing files in Telegram channel */
export class StorageService {
  private client: TelegramClient;
  private storageChannelId: string | null = null;
  private config: Required<StorageServiceConfig>;

  constructor(client: TelegramClient, serviceConfig: StorageServiceConfig = {}) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...serviceConfig };
    if (this.config.storageChannelId) {
      this.storageChannelId = this.config.storageChannelId;
    }
  }

  async initializeStorageChannel(): Promise<string> {
    this.storageChannelId = await initializeStorageChannel(
      this.client, this.config, this.storageChannelId
    );
    return this.storageChannelId;
  }

  getStorageChannelId(): string {
    return requireChannelId(this.storageChannelId);
  }

  async uploadChunk(
    chunkPath: string,
    manifest: FileManifest,
    chunkIndex: number,
    onProgress?: (progress: number) => void
  ): Promise<number> {
    return uploadChunk(
      this.client, this.getStorageChannelId(), chunkPath, manifest, chunkIndex,
      this.config.floodWaitMultiplier, onProgress
    );
  }

  async uploadAllChunks(
    chunksDir: string,
    manifest: FileManifest,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileManifest> {
    return uploadAllChunks(
      this.client, this.getStorageChannelId(), chunksDir, manifest,
      this.config.floodWaitMultiplier, onProgress
    );
  }

  async uploadManifest(manifest: FileManifest): Promise<number> {
    return uploadManifest(this.client, this.getStorageChannelId(), manifest);
  }

  async downloadChunk(
    messageId: number,
    outputPath: string,
    expectedHash?: string,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    return downloadChunk(
      this.client, this.getStorageChannelId(), messageId, outputPath, expectedHash, onProgress
    );
  }

  async getManifestFromMessage(messageId: number): Promise<FileManifest | null> {
    return getManifestFromMessage(this.client, this.getStorageChannelId(), messageId);
  }

  async listStoredFiles(): Promise<StoredFileInfo[]> {
    return listStoredFiles(this.client, this.getStorageChannelId());
  }

  async listByPath(pathPrefix: string): Promise<StoredFileInfo[]> {
    return listByPath(this.client, this.getStorageChannelId(), pathPrefix);
  }

  async findByPath(virtualPath: string): Promise<StoredFileInfo | null> {
    return findByPath(this.client, this.getStorageChannelId(), virtualPath);
  }

  async findByHash(hash: string): Promise<StoredFileInfo | null> {
    return findByHash(this.client, this.getStorageChannelId(), hash);
  }

  async deleteStoredFile(manifestMessageId: number): Promise<boolean> {
    return deleteStoredFile(this.client, this.getStorageChannelId(), manifestMessageId);
  }
}

export default StorageService;
