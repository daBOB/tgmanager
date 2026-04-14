// Storage channel lifecycle: find or create a Telegram channel for storage.
import { Api } from 'telegram';
import type { TelegramClient } from '../types/index.js';
import logger from '../logger.js';

export interface StorageServiceConfig {
  storageChannelId?: string;
  storageChannelTitle?: string;
  maxConcurrentUploads?: number;
  floodWaitMultiplier?: number;
}

export const DEFAULT_CONFIG: Required<StorageServiceConfig> = {
  storageChannelId: '',
  storageChannelTitle: 'TGManager Storage',
  maxConcurrentUploads: 3,
  floodWaitMultiplier: 1.5
};

/** Build caption string for chunk message (used for searching) */
export function buildChunkCaption(fileId: string, chunk: { index: number; hash: string; size: number }): string {
  return `#chunk fileId:${fileId} index:${chunk.index} hash:${chunk.hash} size:${chunk.size}`;
}

/** Sanitize text for use in captions (remove newlines, backticks, hashtags) */
export function sanitizeCaption(text: string): string {
  return text
    .replace(/[\n\r]/g, ' ')
    .replace(/`/g, "'")
    .replace(/#/g, '')
    .slice(0, 200);
}

/** Sleep utility for rate limiting */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Initialize or get existing storage channel (auto-creates if not found) */
export async function initializeStorageChannel(
  client: TelegramClient,
  config: Required<StorageServiceConfig>,
  currentChannelId: string | null
): Promise<string> {
  if (currentChannelId) {
    logger.debug('Using existing storage channel', { channelId: currentChannelId });
    return currentChannelId;
  }

  // Try to find existing channel by title
  const dialogs = await client.getDialogs({ limit: 100 });
  for (const dialog of dialogs) {
    if (dialog.title === config.storageChannelTitle && dialog.isChannel) {
      const id = dialog.id?.toString() || null;
      if (id) {
        logger.info('Found existing storage channel', { channelId: id });
        return id;
      }
    }
  }

  // Create new storage channel
  logger.info('Creating new storage channel', { title: config.storageChannelTitle });

  const result = await client.invoke(
    new Api.channels.CreateChannel({
      title: config.storageChannelTitle,
      about: 'TGManager file storage - DO NOT DELETE',
      broadcast: true,
      megagroup: false,
    })
  );

  const channel = (result as any).chats?.[0] as Api.Channel;
  if (!channel) {
    throw new Error('Failed to create storage channel');
  }

  const channelId = `-100${channel.id.toJSNumber()}`;
  logger.info('Storage channel created', { channelId });
  return channelId;
}

/** Get storage channel ID, throws if not initialized */
export function requireChannelId(storageChannelId: string | null): string {
  if (!storageChannelId) {
    throw new Error('Storage channel not initialized. Call initializeStorageChannel() first.');
  }
  return storageChannelId;
}
