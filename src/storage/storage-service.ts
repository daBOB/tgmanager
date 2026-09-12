// src/storage/storage-service.ts
// Thin facade: StorageService class delegates to focused modules.
// Re-exports the full public surface so all existing import sites work unchanged.

import type { TelegramClient } from '../types/index.js';
import type { FileManifest } from './manifest-manager.js';
import type { StorageServiceConfig } from './storage-channel-manager.js';
import {
  DEFAULT_CONFIG,
  initializeStorageChannel,
  requireChannelId
} from './storage-channel-manager.js';
import type { UploadProgress } from './storage-file-uploader.js';
import {
  uploadChunk,
  uploadAllChunks,
  uploadManifest
} from './storage-file-uploader.js';
import {
  downloadChunk,
  getManifestFromMessage,
  deleteStoredFile
} from './storage-file-downloader.js';
import type { StoredFileInfo } from './storage-file-finder.js';
import { StorageIndex } from './storage-file-finder.js';

export type { StoredFileInfo, UploadProgress, StorageServiceConfig };

/** Storage service for managing files in Telegram channel */
export class StorageService {
  private client: TelegramClient;
  private storageChannelId: string | null = null;
  private config: Required<StorageServiceConfig>;
  /** Lazily built so one service instance walks the channel history at most once. */
  private index: StorageIndex | null = null;

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
    const messageId = await uploadManifest(this.client, this.getStorageChannelId(), manifest);
    // Keep an already-built index current so a later lookup in the same run
    // sees this file without re-reading the whole channel.
    this.getIndex().add(manifest, messageId);
    return messageId;
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

  /** Index over the storage channel, shared by every lookup on this instance. */
  private getIndex(): StorageIndex {
    this.index ??= new StorageIndex(this.client, this.getStorageChannelId());
    return this.index;
  }

  async listStoredFiles(): Promise<StoredFileInfo[]> {
    return this.getIndex().all();
  }

  async listByPath(pathPrefix: string): Promise<StoredFileInfo[]> {
    return this.getIndex().listByPath(pathPrefix);
  }

  async findByPath(virtualPath: string): Promise<StoredFileInfo | null> {
    return this.getIndex().findByPath(virtualPath);
  }

  async findByHash(hash: string): Promise<StoredFileInfo | null> {
    return this.getIndex().findByHash(hash);
  }

  async deleteStoredFile(manifestMessageId: number): Promise<boolean> {
    const deleted = await deleteStoredFile(this.client, this.getStorageChannelId(), manifestMessageId);
    // The cached listing still contains the removed file.
    if (deleted) this.getIndex().invalidate();
    return deleted;
  }
}

export default StorageService;
