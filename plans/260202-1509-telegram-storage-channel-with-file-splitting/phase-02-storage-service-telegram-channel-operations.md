# Phase 02: Storage Service (Telegram Channel Operations)

## Context Links
- [Research: Telegram Storage API](./research/researcher-01-telegram-storage-api.md)
- [Phase 01: Core Utilities](./phase-01-core-utilities-file-splitter-manifest-checksum.md)
- [Existing Uploader](../../src/Uploader.ts)

## Overview
- **Priority:** P1 (Critical Path)
- **Status:** Pending
- **Effort:** 2h
- **Parallelization:** Can run in parallel with Phase 01

## Key Insights
- Storage channel = private Telegram channel for file storage
- Manifest stored as pinned message JSON
- Chunks uploaded as documents with caption metadata
- GramJS `sendFile` for uploads, `downloadMedia` for downloads
- Rate limiting: 1 msg/sec, handle FloodWait errors

## Requirements

### Functional
- Create/configure storage channel automatically
- Upload file chunks to storage channel
- Download chunks by message ID
- Store/retrieve file manifests from channel
- List all files in storage channel
- Delete files (remove all chunks + manifest)

### Non-Functional
- Handle Telegram rate limits with exponential backoff
- Progress callbacks for upload/download operations
- Retry failed chunk uploads automatically
- Support 3-5 concurrent chunk uploads

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   StorageService                          │
├──────────────────────────────────────────────────────────┤
│ - client: TelegramClient                                  │
│ - storageChannelId: string                               │
├──────────────────────────────────────────────────────────┤
│ + initializeStorageChannel(): Promise<string>            │
│ + uploadChunk(path, manifest, index): Promise<number>    │
│ + downloadChunk(messageId, outputPath): Promise<boolean> │
│ + uploadManifest(manifest): Promise<number>              │
│ + getManifest(messageId): Promise<FileManifest>          │
│ + listStoredFiles(): Promise<StoredFileInfo[]>           │
│ + deleteStoredFile(fileId): Promise<boolean>             │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│                  Telegram Channel                         │
├──────────────────────────────────────────────────────────┤
│ Pinned: Master index message (JSON with all manifests)   │
│ Messages: Chunks as documents + Manifests as text        │
│ Caption format: #chunk fileId:index hash:xxx size:xxx    │
│ Hashtags: #manifest #chunk for filtering                 │
└──────────────────────────────────────────────────────────┘
```

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/storage/storage-service.ts` | Telegram storage operations |

### Files NOT Modified (Owned by Other Phases)
- `src/storage/file-splitter.ts` → Phase 01
- `src/storage/manifest-manager.ts` → Phase 01
- `src/index.ts` → Phase 03
- `src/types/index.ts` → Phase 03

### Dependencies from Phase 01
- `FileManifest` type from `manifest-manager.ts`
- `ChunkInfo` type from `manifest-manager.ts`

## Implementation Steps

### Step 1: Create storage-service.ts
```typescript
// src/storage/storage-service.ts
import { Api } from 'telegram';
import { createReadStream } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { TelegramClient } from '../types/index.js';
import {
  FileManifest,
  loadManifest,
  saveManifest,
  updateChunkMessageId,
  updateManifestStatus
} from './manifest-manager.js';
import { verifyChunk } from './checksum-utils.js';
import logger from '../logger.js';
import config from '../config.js';

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
   * Initialize or get existing storage channel
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
   * Upload a single chunk to storage channel
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
   * Upload all chunks for a manifest with concurrency control
   */
  async uploadAllChunks(
    chunksDir: string,
    manifest: FileManifest,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileManifest> {
    let updatedManifest = { ...manifest };
    const totalBytes = manifest.originalSize;
    let bytesUploaded = 0;

    // Upload chunks sequentially to respect rate limits
    // TODO: Implement parallel with pLimit for better performance
    for (let i = 0; i < manifest.chunks.length; i++) {
      const chunk = manifest.chunks[i];
      const chunkPath = join(chunksDir, chunk.filename);

      const messageId = await this.uploadChunk(chunkPath, updatedManifest, i, (p) => {
        if (onProgress) {
          const chunkProgress = (p / 100) * chunk.size;
          onProgress({
            chunkIndex: i,
            totalChunks: manifest.totalChunks,
            bytesUploaded: bytesUploaded + chunkProgress,
            totalBytes,
            percentage: Math.floor(((bytesUploaded + chunkProgress) / totalBytes) * 100)
          });
        }
      });

      updatedManifest = updateChunkMessageId(updatedManifest, i, messageId);
      bytesUploaded += chunk.size;

      // Small delay between uploads to avoid rate limits
      if (i < manifest.chunks.length - 1) {
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
    const caption = `#manifest fileId:${manifest.fileId} path:${manifest.originalPath} name:${manifest.originalName}`;

    const message = await this.client.sendMessage(channelId, {
      message: `${caption}\n\n\`\`\`json\n${manifestJson}\n\`\`\``,
    });

    logger.info('Manifest uploaded', {
      fileId: manifest.fileId,
      messageId: message.id
    });

    return message.id;
  }

  /**
   * Download a chunk by message ID
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
      progressCallback: onProgress ? (p: number) => onProgress(p * 100) : undefined,
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
   * Get manifest from message
   */
  async getManifestFromMessage(messageId: number): Promise<FileManifest | null> {
    const channelId = this.getStorageChannelId();

    const messages = await this.client.getMessages(channelId, { ids: [messageId] });
    const message = messages[0];

    if (!message || !message.message) {
      return null;
    }

    // Extract JSON from code block
    const jsonMatch = message.message.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[1]) as FileManifest;
    } catch {
      return null;
    }
  }

  /**
   * List all stored files by searching for manifest messages
   */
  async listStoredFiles(): Promise<StoredFileInfo[]> {
    const channelId = this.getStorageChannelId();
    const files: StoredFileInfo[] = [];

    // Search for manifest messages
    const messages = await this.client.getMessages(channelId, {
      search: '#manifest',
      limit: 100
    });

    for (const message of messages) {
      if (!message.message?.includes('#manifest')) continue;

      const manifest = await this.parseManifestFromMessage(message);
      if (manifest) {
        files.push({
          fileId: manifest.fileId,
          originalName: manifest.originalName,
          virtualPath: manifest.originalPath,
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
   * Find file by virtual path
   */
  async findByPath(virtualPath: string): Promise<StoredFileInfo | null> {
    const allFiles = await this.listStoredFiles();
    return allFiles.find(f => f.virtualPath === virtualPath) || null;
  }

  /**
   * Delete stored file (chunks + manifest)
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
   * Build caption for chunk message
   */
  private buildChunkCaption(fileId: string, chunk: { index: number; hash: string; size: number }): string {
    return `#chunk fileId:${fileId} index:${chunk.index} hash:${chunk.hash} size:${chunk.size}`;
  }

  /**
   * Parse manifest from message text
   */
  private async parseManifestFromMessage(message: Api.Message): Promise<FileManifest | null> {
    if (!message.message) return null;

    const jsonMatch = message.message.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[1]) as FileManifest;
    } catch {
      return null;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default StorageService;
```

### Step 2: Update barrel export
```typescript
// Add to src/storage/index.ts
export * from './storage-service.js';
```

## Todo List
- [ ] Implement `storage-service.ts` with all methods
- [ ] Add `StorageService` export to `index.ts` barrel
- [ ] Run `npm run build:ts` to verify no compile errors
- [ ] Test channel creation with test account
- [ ] Test chunk upload/download cycle

## Success Criteria
- [x] Storage channel auto-created on first use
- [x] Chunks upload with proper caption/hashtag format
- [x] Manifests stored as searchable JSON messages
- [x] Download retrieves chunks by message ID
- [x] List operation finds all stored files
- [x] Delete removes all chunks + manifest

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Telegram rate limits | High | FloodWait handling + delays |
| Channel search limits | Medium | Use hashtag filtering |
| Message deletion fails | Medium | Retry logic + logging |
| Storage channel deleted | High | User education + backup |

## Security Considerations
- Storage channel is private by default
- No sensitive data in captions (only hashes/IDs)
- Manifest contains file metadata but no content

## Conflict Prevention Strategy
- **Exclusive ownership** of `src/storage/storage-service.ts`
- Uses types from Phase 01 via imports (no modifications)
- No modifications to existing project files

## Next Steps
After Phase 02 completes:
- Phase 03 integrates StorageService into CLI commands
- Phase 03 adds proper types to `src/types/index.ts`
