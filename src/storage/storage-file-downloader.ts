// Download chunks and manifests from a Telegram storage channel, with hash verification and deletion.
import { Api } from 'telegram';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { TelegramClient } from '../types/index.js';
import type { FileManifest } from './manifest-manager.js';
import { verifyFile } from './checksum-utils.js';
import logger from '../logger.js';

/**
 * Parse manifest from message text or file attachment.
 * Telegram strips markdown backtick formatting, so we find the first '{' directly.
 */
export async function parseManifestFromMessage(
  client: TelegramClient,
  message: Api.Message
): Promise<FileManifest | null> {
  // Try extracting JSON from message text
  if (message.message) {
    const jsonStart = message.message.indexOf('{');
    if (jsonStart >= 0) {
      try {
        return JSON.parse(message.message.substring(jsonStart)) as FileManifest;
      } catch {
        // Fall through to file attachment fallback
      }
    }
  }

  // Try downloading as file attachment
  if (message.media) {
    try {
      const buffer = await client.downloadMedia(message);
      if (buffer) {
        return JSON.parse((buffer as Buffer).toString('utf-8')) as FileManifest;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

/** Get manifest from message ID by parsing JSON from text or file attachment */
export async function getManifestFromMessage(
  client: TelegramClient,
  channelId: string,
  messageId: number
): Promise<FileManifest | null> {
  const messages = await client.getMessages(channelId, { ids: [messageId] });
  const message = messages[0];
  if (!message) return null;
  return parseManifestFromMessage(client, message);
}

/** Download a chunk by message ID with optional hash integrity verification */
export async function downloadChunk(
  client: TelegramClient,
  channelId: string,
  messageId: number,
  outputPath: string,
  expectedHash?: string,
  onProgress?: (progress: number) => void
): Promise<boolean> {
  // Ensure output directory exists
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const messages = await client.getMessages(channelId, { ids: [messageId] });
  const message = messages[0];

  if (!message || !message.media) {
    logger.error('Chunk message not found', { messageId });
    return false;
  }

  // Download media directly to file (avoids loading multi-GB chunks into memory)
  const result = await client.downloadMedia(message, {
    outputFile: outputPath,
    progressCallback: onProgress ? (downloaded: any) => {
      const progress = typeof downloaded === 'number' ? downloaded : Number(downloaded);
      onProgress(progress * 100);
    } : undefined,
  });

  if (!result) {
    logger.error('Failed to download chunk', { messageId });
    return false;
  }

  if (expectedHash) {
    const isValid = await verifyFile(outputPath, expectedHash);
    if (!isValid) {
      logger.error('Chunk hash verification failed', { messageId, expectedHash });
      return false;
    }
  }

  logger.debug('Chunk downloaded', { messageId, outputPath });
  return true;
}

/** Delete stored file: removes all chunk messages and the manifest message */
export async function deleteStoredFile(
  client: TelegramClient,
  channelId: string,
  manifestMessageId: number
): Promise<boolean> {
  const manifest = await getManifestFromMessage(client, channelId, manifestMessageId);
  if (!manifest) {
    logger.error('Manifest not found for deletion', { manifestMessageId });
    return false;
  }

  const messageIds: number[] = [manifestMessageId];
  for (const chunk of manifest.chunks) {
    if (chunk.messageId) messageIds.push(chunk.messageId);
  }

  try {
    await client.deleteMessages(channelId, messageIds, { revoke: true });
    logger.info('Stored file deleted', { fileId: manifest.fileId, messagesDeleted: messageIds.length });
    return true;
  } catch (error) {
    logger.error('Failed to delete stored file', {
      fileId: manifest.fileId,
      error: (error as Error).message
    });
    return false;
  }
}
