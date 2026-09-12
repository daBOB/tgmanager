// Upload chunks and manifests to a Telegram storage channel with retry/resume support.
import type { TelegramClient } from '../types/index.js';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FileManifest } from './manifest-manager.js';
import { updateChunkMessageId, getChunksToUpload } from './manifest-manager.js';
import { buildChunkCaption, sanitizeCaption } from './storage-channel-manager.js';
import { sleep } from '../utils/sleep.js';
import logger from '../logger.js';
import { withFloodWaitRetry } from '../utils/flood-wait-retry.js';

export interface UploadProgress {
  chunkIndex: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

/** Upload a single chunk to the storage channel with FloodWait retry logic */
export async function uploadChunk(
  client: TelegramClient,
  channelId: string,
  chunkPath: string,
  manifest: FileManifest,
  chunkIndex: number,
  floodWaitMultiplier: number,
  onProgress?: (progress: number) => void
): Promise<number> {
  const chunk = manifest.chunks[chunkIndex];
  if (!chunk) throw new Error(`Chunk ${chunkIndex} not found in manifest`);

  const caption = buildChunkCaption(manifest.fileId, chunk);

  const message = await withFloodWaitRetry(
    () => client.sendFile(channelId, {
      file: chunkPath,
      caption,
      progressCallback: onProgress ? (p: number): void => onProgress(p * 100) : undefined,
    }),
    { multiplier: floodWaitMultiplier, context: { fileId: manifest.fileId, chunkIndex } }
  );
  logger.debug('Chunk uploaded', { fileId: manifest.fileId, chunkIndex, messageId: message.id });
  return message.id;
}

/** Upload all chunks for a manifest with resume support */
export async function uploadAllChunks(
  client: TelegramClient,
  channelId: string,
  chunksDir: string,
  manifest: FileManifest,
  floodWaitMultiplier: number,
  onProgress?: (progress: UploadProgress) => void
): Promise<FileManifest> {
  let updatedManifest = { ...manifest };
  const totalBytes = manifest.originalSize;
  let bytesUploaded = 0;

  const chunksToUpload = getChunksToUpload(manifest);

  // Calculate already-uploaded bytes for resume
  for (const chunk of manifest.chunks) {
    if (chunk.uploaded && chunk.messageId) bytesUploaded += chunk.size;
  }

  if (chunksToUpload.length < manifest.totalChunks) {
    logger.info('Resuming upload', {
      uploaded: manifest.totalChunks - chunksToUpload.length,
      remaining: chunksToUpload.length
    });
  }

  for (const chunk of manifest.chunks) {
    if (chunk.uploaded && chunk.messageId) continue;

    const chunkPath = join(chunksDir, chunk.filename);
    const messageId = await uploadChunk(
      client, channelId, chunkPath, updatedManifest, chunk.index, floodWaitMultiplier,
      onProgress ? (p: number): void => {
        const chunkProgress = (p / 100) * chunk.size;
        onProgress({
          chunkIndex: chunk.index,
          totalChunks: manifest.totalChunks,
          bytesUploaded: bytesUploaded + chunkProgress,
          totalBytes,
          percentage: Math.floor(((bytesUploaded + chunkProgress) / totalBytes) * 100)
        });
      } : undefined
    );

    updatedManifest = updateChunkMessageId(updatedManifest, chunk.index, messageId);
    bytesUploaded += chunk.size;

    // Small delay between uploads to avoid rate limits
    if (chunk.index < manifest.chunks.length - 1) await sleep(500);
  }

  return updatedManifest;
}

/** Upload manifest as JSON message (or file attachment if too large) to storage channel */
export async function uploadManifest(
  client: TelegramClient,
  channelId: string,
  manifest: FileManifest
): Promise<number> {
  const manifestJson = JSON.stringify(manifest, null, 2);
  const caption = `#manifest fileId:${manifest.fileId} path:${sanitizeCaption(manifest.originalPath)} name:${sanitizeCaption(manifest.originalName)}`;

  // Telegram message limit is 4096 chars.
  // Note: Don't use ```json code blocks — Telegram strips backtick formatting
  // from the raw message text, breaking JSON extraction on retrieval.
  const fullMessage = `${caption}\n\n${manifestJson}`;

  if (fullMessage.length <= 4096) {
    const message = await client.sendMessage(channelId, { message: fullMessage });
    logger.info('Manifest uploaded as message', { fileId: manifest.fileId, messageId: message.id });
    return message.id;
  }

  // Large manifest: upload as JSON file attachment
  const tempPath = join(tmpdir(), `${manifest.fileId}.manifest.json`);
  await writeFile(tempPath, manifestJson, 'utf-8');

  // sendFile is declared as returning the broad Message union; every variant it
  // can actually return here carries a numeric id.
  const message: { id: number } = await client.sendFile(channelId, { file: tempPath, caption });

  await unlink(tempPath).catch(() => {});

  logger.info('Manifest uploaded as file (exceeded message limit)', {
    fileId: manifest.fileId,
    messageId: message.id,
    size: manifestJson.length
  });
  return message.id;
}
