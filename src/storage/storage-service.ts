// src/storage/storage-service.ts
import { Api } from 'telegram';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { TelegramClient } from '../types/index.js';
import {
  FileManifest,
  updateChunkMessageId,
  getChunksToUpload
} from './manifest-manager.js';
import { verifyChunk } from './checksum-utils.js';
import logger from '../logger.js';

export interface StoredFileInfo {
  fileId: string;
  originalName: string;
  virtualPath: string;
  size: number;
  status: FileManifest['status'];
  createdAt: string;
  manifestMessageId: number;
}

export interface UploadProgress {
  chunkIndex: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

export interface StorageServiceConfig {
  storageChannelId?: string;
  storageChannelTitle?: string;
  maxConcurrentUploads?: number;
  floodWaitMultiplier?: number;
}

const DEFAULT_CONFIG: Required<StorageServiceConfig> = {
  storageChannelId: '',
  storageChannelTitle: 'TGManager Storage',
  maxConcurrentUploads: 3,
  floodWaitMultiplier: 1.5
};

/**
 * Storage service for managing files in Telegram channel
 * Handles chunk upload/download, manifest storage, and file listing
 */
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

  /**
   * Initialize or get existing storage channel (auto-creates if not found)
   */
  async initializeStorageChannel(): Promise<string> {
    if (this.storageChannelId) {
      logger.debug('Using existing storage channel', { channelId: this.storageChannelId });
      return this.storageChannelId;
    }

    // Try to find existing storage channel by title
    const dialogs = await this.client.getDialogs({ limit: 100 });
    for (const dialog of dialogs) {
      if (dialog.title === this.config.storageChannelTitle && dialog.isChannel) {
        this.storageChannelId = dialog.id?.toString() || null;
        if (this.storageChannelId) {
          logger.info('Found existing storage channel', { channelId: this.storageChannelId });
          return this.storageChannelId;
        }
      }
    }

    // Create new storage channel
    logger.info('Creating new storage channel', { title: this.config.storageChannelTitle });

    const result = await this.client.invoke(
      new Api.channels.CreateChannel({
        title: this.config.storageChannelTitle,
        about: 'TGManager file storage - DO NOT DELETE',
        broadcast: true,
        megagroup: false,
      })
    );

    const channel = (result as any).chats?.[0] as Api.Channel;
    if (!channel) {
      throw new Error('Failed to create storage channel');
    }

    this.storageChannelId = `-100${channel.id.toJSNumber()}`;
    logger.info('Storage channel created', { channelId: this.storageChannelId });

    return this.storageChannelId;
  }

  /**
   * Get storage channel ID (must be initialized first)
   */
  getStorageChannelId(): string {
    if (!this.storageChannelId) {
      throw new Error('Storage channel not initialized. Call initializeStorageChannel() first.');
    }
    return this.storageChannelId;
  }

  /**
   * Upload a single chunk to storage channel with retry logic
   */
  async uploadChunk(
    chunkPath: string,
    manifest: FileManifest,
    chunkIndex: number,
    onProgress?: (progress: number) => void
  ): Promise<number> {
    const channelId = this.getStorageChannelId();
    const chunk = manifest.chunks[chunkIndex];

    if (!chunk) {
      throw new Error(`Chunk ${chunkIndex} not found in manifest`);
    }

    const caption = this.buildChunkCaption(manifest.fileId, chunk);

    const upload = async (retryCount = 0): Promise<Api.Message> => {
      try {
        const result = await this.client.sendFile(channelId, {
          file: chunkPath,
          caption,
          progressCallback: onProgress ? (p: number) => onProgress(p * 100) : undefined,
        });
        return result as Api.Message;
      } catch (error: any) {
        // Handle FloodWait errors with exponential backoff
        if (error.code === 420 && retryCount < 10) {
          const waitSeconds = error.seconds ?? 60;
          const waitWithBuffer = Math.max(1, Math.ceil(waitSeconds * this.config.floodWaitMultiplier));

          logger.warn('Flood wait on chunk upload, retrying', {
            chunkIndex,
            waitSeconds: waitWithBuffer,
            retryCount
          });

          await this.sleep(waitWithBuffer * 1000);
          return upload(retryCount + 1);
        }
        throw error;
      }
    };

    const message = await upload();
    const messageId = message.id;

    logger.debug('Chunk uploaded', {
      fileId: manifest.fileId,
      chunkIndex,
      messageId
    });

    return messageId;
  }

  /**
   * Upload all chunks for a manifest with resume support
   */
  async uploadAllChunks(
    chunksDir: string,
    manifest: FileManifest,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileManifest> {
    const { join } = await import('path');
    let updatedManifest = { ...manifest };
    const totalBytes = manifest.originalSize;
    let bytesUploaded = 0;

    // Get chunks that need uploading (resume support)
    const chunksToUpload = getChunksToUpload(manifest);

    // Calculate already uploaded bytes for resume
    for (const chunk of manifest.chunks) {
      if (chunk.uploaded && chunk.messageId) {
        bytesUploaded += chunk.size;
      }
    }

    if (chunksToUpload.length < manifest.totalChunks) {
      logger.info('Resuming upload', {
        uploaded: manifest.totalChunks - chunksToUpload.length,
        remaining: chunksToUpload.length
      });
    }

    // Upload chunks sequentially to respect rate limits
    for (const chunk of manifest.chunks) {
      // Skip already uploaded chunks (resume support)
      if (chunk.uploaded && chunk.messageId) {
        continue;
      }

      const chunkPath = join(chunksDir, chunk.filename);

      const messageId = await this.uploadChunk(chunkPath, updatedManifest, chunk.index, (p) => {
        if (onProgress) {
          const chunkProgress = (p / 100) * chunk.size;
          onProgress({
            chunkIndex: chunk.index,
            totalChunks: manifest.totalChunks,
            bytesUploaded: bytesUploaded + chunkProgress,
            totalBytes,
            percentage: Math.floor(((bytesUploaded + chunkProgress) / totalBytes) * 100)
          });
        }
      });

      updatedManifest = updateChunkMessageId(updatedManifest, chunk.index, messageId);
      bytesUploaded += chunk.size;

      // Small delay between uploads to avoid rate limits
      if (chunk.index < manifest.chunks.length - 1) {
        await this.sleep(500);
      }
    }

    return updatedManifest;
  }

  /**
   * Upload manifest as JSON message to storage channel
   */
  async uploadManifest(manifest: FileManifest): Promise<number> {
    const channelId = this.getStorageChannelId();
    const manifestJson = JSON.stringify(manifest, null, 2);
    const caption = `#manifest fileId:${manifest.fileId} path:${this.sanitizeCaption(manifest.originalPath)} name:${this.sanitizeCaption(manifest.originalName)}`;

    // Telegram message limit is 4096 chars.
    // Note: Don't use ```json code blocks — Telegram strips backtick formatting
    // from the raw message text, breaking JSON extraction on retrieval.
    const fullMessage = `${caption}\n\n${manifestJson}`;

    if (fullMessage.length <= 4096) {
      const message = await this.client.sendMessage(channelId, { message: fullMessage });
      logger.info('Manifest uploaded as message', { fileId: manifest.fileId, messageId: message.id });
      return message.id;
    }

    // Large manifest: upload as JSON file
    const { writeFile: writeFileAsync } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const tempPath = join(tmpdir(), `${manifest.fileId}.manifest.json`);
    await writeFileAsync(tempPath, manifestJson, 'utf-8');

    const message = await this.client.sendFile(channelId, {
      file: tempPath,
      caption,
    });

    // Clean up temp file
    const { unlink } = await import('fs/promises');
    await unlink(tempPath).catch(() => {});

    logger.info('Manifest uploaded as file (exceeded message limit)', {
      fileId: manifest.fileId,
      messageId: (message as any).id,
      size: manifestJson.length
    });

    return (message as any).id;
  }

  /**
   * Download a chunk by message ID with integrity verification
   */
  async downloadChunk(
    messageId: number,
    outputPath: string,
    expectedHash?: string,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    const channelId = this.getStorageChannelId();

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    // Get the message
    const messages = await this.client.getMessages(channelId, { ids: [messageId] });
    const message = messages[0];

    if (!message || !message.media) {
      logger.error('Chunk message not found', { messageId });
      return false;
    }

    // Download the media
    const buffer = await this.client.downloadMedia(message, {
      progressCallback: onProgress ? (downloaded: any) => {
        const progress = typeof downloaded === 'number' ? downloaded : Number(downloaded);
        onProgress(progress * 100);
      } : undefined,
    });

    if (!buffer) {
      logger.error('Failed to download chunk', { messageId });
      return false;
    }

    // Verify hash if provided
    if (expectedHash) {
      const isValid = verifyChunk(buffer as Buffer, expectedHash);
      if (!isValid) {
        logger.error('Chunk hash verification failed', { messageId, expectedHash });
        return false;
      }
    }

    // Write to file
    await writeFile(outputPath, buffer as Buffer);

    logger.debug('Chunk downloaded', { messageId, outputPath });
    return true;
  }

  /**
   * Get manifest from message by parsing JSON from text or file attachment
   */
  async getManifestFromMessage(messageId: number): Promise<FileManifest | null> {
    const channelId = this.getStorageChannelId();

    const messages = await this.client.getMessages(channelId, { ids: [messageId] });
    const message = messages[0];

    if (!message) {
      return null;
    }

    return this.parseManifestFromMessage(message);

    return null;
  }

  /**
   * List all stored files by iterating channel messages and filtering for manifests.
   * Uses direct message iteration instead of Telegram search API, which can be
   * unreliable for small/new channels where the search index hasn't been built.
   */
  async listStoredFiles(): Promise<StoredFileInfo[]> {
    const channelId = this.getStorageChannelId();
    const files: StoredFileInfo[] = [];

    // Iterate messages directly — Telegram's search API is unreliable for
    // small or recently created channels where the full-text index may not exist
    const messages = await this.client.getMessages(channelId, {
      limit: 100
    });

    for (const message of messages) {
      if (!message.message?.includes('#manifest')) continue;

      const manifest = await this.parseManifestFromMessage(message);
      if (manifest) {
        // Build full virtual path: originalPath is the directory prefix (e.g., "Video/VR"),
        // originalName is the filename. Join them to get full path for lookup.
        const dir = manifest.originalPath.replace(/\/+$/, '');
        const fullPath = dir ? `${dir}/${manifest.originalName}` : manifest.originalName;

        files.push({
          fileId: manifest.fileId,
          originalName: manifest.originalName,
          virtualPath: fullPath,
          size: manifest.originalSize,
          status: manifest.status,
          createdAt: manifest.createdAt,
          manifestMessageId: message.id
        });
      }
    }

    return files;
  }

  /**
   * List files by virtual path prefix
   */
  async listByPath(pathPrefix: string): Promise<StoredFileInfo[]> {
    const allFiles = await this.listStoredFiles();
    return allFiles.filter(f => f.virtualPath.startsWith(pathPrefix));
  }

  /**
   * Find file by exact virtual path
   */
  async findByPath(virtualPath: string): Promise<StoredFileInfo | null> {
    const allFiles = await this.listStoredFiles();
    return allFiles.find(f => f.virtualPath === virtualPath) || null;
  }

  /**
   * Delete stored file (all chunks + manifest message)
   */
  async deleteStoredFile(manifestMessageId: number): Promise<boolean> {
    const channelId = this.getStorageChannelId();

    // Get manifest to find chunk message IDs
    const manifest = await this.getManifestFromMessage(manifestMessageId);
    if (!manifest) {
      logger.error('Manifest not found for deletion', { manifestMessageId });
      return false;
    }

    // Collect all message IDs to delete
    const messageIds: number[] = [manifestMessageId];
    for (const chunk of manifest.chunks) {
      if (chunk.messageId) {
        messageIds.push(chunk.messageId);
      }
    }

    // Delete all messages
    try {
      await this.client.deleteMessages(channelId, messageIds, { revoke: true });
      logger.info('Stored file deleted', {
        fileId: manifest.fileId,
        messagesDeleted: messageIds.length
      });
      return true;
    } catch (error) {
      logger.error('Failed to delete stored file', {
        fileId: manifest.fileId,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Build caption string for chunk message (used for searching)
   */
  private buildChunkCaption(fileId: string, chunk: { index: number; hash: string; size: number }): string {
    return `#chunk fileId:${fileId} index:${chunk.index} hash:${chunk.hash} size:${chunk.size}`;
  }

  /**
   * Parse manifest from message text or file attachment.
   * Note: Telegram strips markdown backtick formatting from messages, so we
   * extract the JSON object directly by finding the first '{' character.
   */
  private async parseManifestFromMessage(message: Api.Message): Promise<FileManifest | null> {
    // Try extracting JSON from message text
    if (message.message) {
      // Find the JSON object start — Telegram strips ```json code block markers,
      // so we locate the first '{' which starts the manifest JSON
      const jsonStart = message.message.indexOf('{');
      if (jsonStart >= 0) {
        try {
          const jsonContent = message.message.substring(jsonStart);
          return JSON.parse(jsonContent) as FileManifest;
        } catch {
          // Fall through to file attachment fallback
        }
      }
    }

    // Try downloading as file attachment
    if (message.media) {
      try {
        const buffer = await this.client.downloadMedia(message);
        if (buffer) {
          return JSON.parse((buffer as Buffer).toString('utf-8')) as FileManifest;
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }

  /**
   * Sanitize text for use in captions (remove newlines, backticks, hashtags)
   */
  private sanitizeCaption(text: string): string {
    return text
      .replace(/[\n\r]/g, ' ')
      .replace(/`/g, "'")
      .replace(/#/g, '')
      .slice(0, 200);
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default StorageService;
