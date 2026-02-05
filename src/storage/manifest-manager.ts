// src/storage/manifest-manager.ts
import { writeFile, readFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface ChunkInfo {
  index: number;
  filename: string;
  size: number;
  hash: string;
  messageId?: number;  // Telegram message ID after upload
  uploadedAt?: string; // ISO timestamp when chunk was uploaded
  uploaded?: boolean;  // Resume tracking flag
}

export interface FileManifest {
  fileId: string;
  version: 1;
  originalName: string;
  originalPath: string;  // Virtual path in storage
  originalSize: number;
  originalHash: string;
  chunkSize: number;
  totalChunks: number;
  chunks: ChunkInfo[];
  status: 'splitting' | 'uploading' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
}

// ~1.9GB chunk size — stays under the 2GB regular account upload limit.
// Premium accounts allow 4GB but we use a safe default for all account types.
export const DEFAULT_CHUNK_SIZE = Math.floor(1.9 * 1024 * 1024 * 1024);

/**
 * Create new manifest for file splitting operation
 */
export function createManifest(
  originalName: string,
  virtualPath: string,
  originalSize: number,
  originalHash: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): FileManifest {
  chunkSize = Math.floor(chunkSize);
  const totalChunks = Math.ceil(originalSize / chunkSize);
  const fileId = randomUUID();
  const now = new Date().toISOString();

  return {
    fileId,
    version: 1,
    originalName,
    originalPath: virtualPath,
    originalSize,
    originalHash,
    chunkSize,
    totalChunks,
    chunks: [],
    status: 'splitting',
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Add chunk info to manifest
 */
export function addChunkToManifest(
  manifest: FileManifest,
  chunk: Omit<ChunkInfo, 'uploadedAt'>
): FileManifest {
  const newChunk: ChunkInfo = {
    index: chunk.index,
    filename: chunk.filename,
    size: chunk.size,
    hash: chunk.hash,
    messageId: chunk.messageId,
    uploaded: chunk.uploaded ?? false
  };

  return {
    ...manifest,
    chunks: [...manifest.chunks, newChunk],
    updatedAt: new Date().toISOString()
  };
}

/**
 * Update chunk with Telegram message ID after upload
 */
export function updateChunkMessageId(
  manifest: FileManifest,
  chunkIndex: number,
  messageId: number
): FileManifest {
  const chunks = manifest.chunks.map(chunk =>
    chunk.index === chunkIndex
      ? { ...chunk, messageId, uploadedAt: new Date().toISOString(), uploaded: true }
      : chunk
  );

  return {
    ...manifest,
    chunks,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Update manifest status
 */
export function updateManifestStatus(
  manifest: FileManifest,
  status: FileManifest['status']
): FileManifest {
  return {
    ...manifest,
    status,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Save manifest to file (atomic write via temp file + rename)
 */
export async function saveManifest(manifest: FileManifest, filePath: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const content = JSON.stringify(manifest, null, 2);

  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, filePath);
}

/**
 * Load manifest from file
 */
export async function loadManifest(filePath: string): Promise<FileManifest | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as FileManifest;
}

/**
 * Get manifest path for a file ID
 */
export function getManifestPath(baseDir: string, fileId: string): string {
  return join(baseDir, `${fileId}.manifest.json`);
}

/**
 * Delete manifest file
 */
export async function deleteManifest(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    const { unlink } = await import('fs/promises');
    await unlink(filePath);
  }
}

/**
 * Get chunks that need uploading (for resume support)
 * A chunk needs uploading if it's not marked as uploaded
 */
export function getChunksToUpload(manifest: FileManifest): ChunkInfo[] {
  return manifest.chunks.filter(chunk => !chunk.uploaded);
}

/**
 * Check if all chunks are uploaded
 */
export function isUploadComplete(manifest: FileManifest): boolean {
  return manifest.chunks.length === manifest.totalChunks &&
         manifest.chunks.every(chunk => chunk.uploaded && chunk.messageId);
}
