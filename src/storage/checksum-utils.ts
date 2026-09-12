// src/storage/checksum-utils.ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export interface ChecksumResult {
  hash: string;
  algorithm: 'sha256';
}

/**
 * Calculate SHA-256 hash of a file using streams (memory efficient)
 */
export async function hashFile(filePath: string): Promise<ChecksumResult> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  await pipeline(stream, hash);

  return {
    hash: hash.digest('hex'),
    algorithm: 'sha256'
  };
}

/**
 * Calculate SHA-256 hash of a buffer/chunk
 */
export function hashChunk(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify chunk integrity against expected hash
 */
export function verifyChunk(data: Buffer, expectedHash: string): boolean {
  const actualHash = hashChunk(data);
  return actualHash === expectedHash;
}

/**
 * Verify file integrity against expected hash
 */
export async function verifyFile(filePath: string, expectedHash: string): Promise<boolean> {
  const result = await hashFile(filePath);
  return result.hash === expectedHash;
}
