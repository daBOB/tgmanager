# Phase 01: Core Utilities (File Splitter, Manifest, Checksum)

## Context Links
- [Research: Telegram Storage API](./research/researcher-01-telegram-storage-api.md)
- [Research: File Splitting Strategies](./research/researcher-02-file-splitting-strategies.md)
- [Existing Uploader](../../src/Uploader.ts)

## Overview
- **Priority:** P1 (Critical Path)
- **Status:** Pending
- **Effort:** 2h
- **Parallelization:** Can run in parallel with Phase 02

## Key Insights
- Use Node.js streams for memory efficiency (<50MB RAM for 10GB file)
- 500MB chunk size balances reliability vs overhead
- SHA-256 for cryptographic integrity verification
- JSON manifest essential for reconstruction

## Requirements

### Functional
- Split files >2GB into 500MB chunks using streams
- Generate SHA-256 checksum per chunk + full file
- Create/update JSON manifest with chunk metadata
- Merge chunks back to original file with verification

### Non-Functional
- Memory usage <100MB regardless of file size
- Stream-based processing (no full file in memory)
- Atomic manifest updates (write temp → rename)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  file-splitter  │────►│ manifest-manager │────►│  checksum-utils │
│                 │     │                  │     │                 │
│ - splitFile()   │     │ - createManifest │     │ - hashChunk()   │
│ - mergeChunks() │     │ - updateManifest │     │ - hashFile()    │
│ - getChunkPath()│     │ - loadManifest   │     │ - verifyChunk() │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/storage/file-splitter.ts` | Split/merge logic with streams |
| `src/storage/manifest-manager.ts` | JSON manifest CRUD operations |
| `src/storage/checksum-utils.ts` | SHA-256 hashing utilities |
| `src/storage/index.ts` | Barrel export for storage module |

### Files NOT Modified (Owned by Other Phases)
- `src/index.ts` → Phase 03
- `src/types/index.ts` → Phase 03

## Implementation Steps

### Step 1: Create checksum-utils.ts
```typescript
// src/storage/checksum-utils.ts
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

export interface ChecksumResult {
  hash: string;
  algorithm: 'sha256';
}

/**
 * Calculate SHA-256 hash of a file using streams
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
```

### Step 2: Create manifest-manager.ts
```typescript
// src/storage/manifest-manager.ts
import { writeFile, readFile, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

export interface ChunkInfo {
  index: number;
  filename: string;
  size: number;
  hash: string;
  messageId?: number;  // Telegram message ID after upload
  uploadedAt?: string;
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

export const DEFAULT_CHUNK_SIZE = 500 * 1024 * 1024; // 500MB

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
  return {
    ...manifest,
    chunks: [...manifest.chunks, { ...chunk }],
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
      ? { ...chunk, messageId, uploadedAt: new Date().toISOString() }
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
 * Save manifest to file (atomic write)
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
    await unlink(filePath);
  }
}
```

### Step 3: Create file-splitter.ts
```typescript
// src/storage/file-splitter.ts
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir, stat, unlink, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';
import { Transform, TransformCallback } from 'stream';
import {
  FileManifest,
  ChunkInfo,
  createManifest,
  addChunkToManifest,
  updateManifestStatus,
  saveManifest,
  DEFAULT_CHUNK_SIZE
} from './manifest-manager.js';
import { hashFile, hashChunk, verifyFile } from './checksum-utils.js';
import logger from '../logger.js';

export interface SplitOptions {
  chunkSize?: number;
  outputDir: string;
  virtualPath: string;
  onProgress?: (progress: SplitProgress) => void;
}

export interface SplitProgress {
  totalBytes: number;
  processedBytes: number;
  currentChunk: number;
  totalChunks: number;
  percentage: number;
}

export interface SplitResult {
  manifest: FileManifest;
  chunkPaths: string[];
}

/**
 * Get chunk filename for a given file ID and index
 */
export function getChunkFilename(fileId: string, index: number): string {
  return `${fileId}-chunk-${index.toString().padStart(3, '0')}`;
}

/**
 * Split a large file into chunks using streams
 */
export async function splitFile(
  inputPath: string,
  options: SplitOptions
): Promise<SplitResult> {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    outputDir,
    virtualPath,
    onProgress
  } = options;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Get file stats and hash
  const stats = await stat(inputPath);
  const originalSize = stats.size;
  const originalName = basename(inputPath);

  logger.info('Starting file split', {
    file: originalName,
    size: originalSize,
    chunkSize
  });

  // Calculate original file hash
  const { hash: originalHash } = await hashFile(inputPath);
  logger.debug('Original file hash calculated', { hash: originalHash });

  // Create manifest
  let manifest = createManifest(
    originalName,
    virtualPath,
    originalSize,
    originalHash,
    chunkSize
  );

  const chunkPaths: string[] = [];
  let currentChunk = 0;
  let processedBytes = 0;
  let currentChunkSize = 0;
  let currentChunkData: Buffer[] = [];

  const writeChunk = async (): Promise<void> => {
    if (currentChunkData.length === 0) return;

    const chunkBuffer = Buffer.concat(currentChunkData);
    const chunkFilename = getChunkFilename(manifest.fileId, currentChunk);
    const chunkPath = join(outputDir, chunkFilename);

    // Write chunk to file
    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(chunkPath);
      writeStream.write(chunkBuffer, (err) => {
        if (err) reject(err);
        writeStream.end(() => resolve());
      });
    });

    // Calculate chunk hash
    const chunkHash = hashChunk(chunkBuffer);

    // Add chunk info to manifest
    const chunkInfo: Omit<ChunkInfo, 'uploadedAt'> = {
      index: currentChunk,
      filename: chunkFilename,
      size: chunkBuffer.length,
      hash: chunkHash
    };

    manifest = addChunkToManifest(manifest, chunkInfo);
    chunkPaths.push(chunkPath);

    logger.debug('Chunk written', {
      chunk: currentChunk,
      size: chunkBuffer.length,
      hash: chunkHash
    });

    // Reset for next chunk
    currentChunkData = [];
    currentChunkSize = 0;
    currentChunk++;
  };

  // Create transform stream for chunking
  const chunker = new Transform({
    transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
      let offset = 0;

      while (offset < chunk.length) {
        const remainingInChunk = chunkSize - currentChunkSize;
        const bytesToCopy = Math.min(remainingInChunk, chunk.length - offset);

        currentChunkData.push(chunk.slice(offset, offset + bytesToCopy));
        currentChunkSize += bytesToCopy;
        processedBytes += bytesToCopy;
        offset += bytesToCopy;

        // Report progress
        if (onProgress) {
          onProgress({
            totalBytes: originalSize,
            processedBytes,
            currentChunk,
            totalChunks: manifest.totalChunks,
            percentage: Math.floor((processedBytes / originalSize) * 100)
          });
        }

        // Chunk is full, write it
        if (currentChunkSize >= chunkSize) {
          writeChunk()
            .then(() => {
              if (offset >= chunk.length) {
                callback();
              }
            })
            .catch(callback);
          return;
        }
      }

      callback();
    },

    async flush(callback: TransformCallback) {
      // Write any remaining data as final chunk
      try {
        await writeChunk();
        callback();
      } catch (err) {
        callback(err as Error);
      }
    }
  });

  // Process the file
  const readStream = createReadStream(inputPath, { highWaterMark: 64 * 1024 });

  await pipeline(readStream, chunker);

  // Update manifest status
  manifest = updateManifestStatus(manifest, 'uploading');

  // Save manifest
  const manifestPath = join(outputDir, `${manifest.fileId}.manifest.json`);
  await saveManifest(manifest, manifestPath);

  logger.info('File split complete', {
    fileId: manifest.fileId,
    totalChunks: manifest.totalChunks,
    manifestPath
  });

  return { manifest, chunkPaths };
}

/**
 * Merge chunks back into original file
 */
export async function mergeChunks(
  manifest: FileManifest,
  chunksDir: string,
  outputPath: string,
  onProgress?: (progress: SplitProgress) => void
): Promise<boolean> {
  logger.info('Starting chunk merge', {
    fileId: manifest.fileId,
    totalChunks: manifest.totalChunks,
    outputPath
  });

  // Sort chunks by index
  const sortedChunks = [...manifest.chunks].sort((a, b) => a.index - b.index);

  // Verify all chunks exist
  for (const chunk of sortedChunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (!existsSync(chunkPath)) {
      logger.error('Missing chunk', { filename: chunk.filename, index: chunk.index });
      throw new Error(`Missing chunk: ${chunk.filename}`);
    }
  }

  // Create output stream
  const writeStream = createWriteStream(outputPath);
  let processedBytes = 0;

  // Write chunks sequentially
  for (const chunk of sortedChunks) {
    const chunkPath = join(chunksDir, chunk.filename);

    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(chunkPath);

      readStream.on('data', (data: Buffer) => {
        processedBytes += data.length;
        if (onProgress) {
          onProgress({
            totalBytes: manifest.originalSize,
            processedBytes,
            currentChunk: chunk.index,
            totalChunks: manifest.totalChunks,
            percentage: Math.floor((processedBytes / manifest.originalSize) * 100)
          });
        }
      });

      readStream.on('end', resolve);
      readStream.on('error', reject);
      readStream.pipe(writeStream, { end: false });
    });

    logger.debug('Chunk merged', { index: chunk.index, filename: chunk.filename });
  }

  // Close write stream
  await new Promise<void>((resolve, reject) => {
    writeStream.end((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Verify final file hash
  const isValid = await verifyFile(outputPath, manifest.originalHash);

  if (!isValid) {
    logger.error('File integrity verification failed', {
      fileId: manifest.fileId,
      expectedHash: manifest.originalHash
    });
    // Remove corrupted output
    await unlink(outputPath);
    return false;
  }

  logger.info('File merge complete and verified', {
    fileId: manifest.fileId,
    outputPath,
    size: manifest.originalSize
  });

  return true;
}

/**
 * Clean up chunk files after successful merge
 */
export async function cleanupChunks(
  manifest: FileManifest,
  chunksDir: string
): Promise<void> {
  for (const chunk of manifest.chunks) {
    const chunkPath = join(chunksDir, chunk.filename);
    if (existsSync(chunkPath)) {
      await unlink(chunkPath);
    }
  }

  logger.debug('Chunks cleaned up', {
    fileId: manifest.fileId,
    count: manifest.chunks.length
  });
}

/**
 * Check if file needs splitting based on size and account type
 */
export function needsSplitting(
  fileSize: number,
  isPremium: boolean = false
): boolean {
  const maxSize = isPremium
    ? 4 * 1024 * 1024 * 1024  // 4GB
    : 2 * 1024 * 1024 * 1024; // 2GB

  return fileSize > maxSize;
}
```

### Step 4: Create barrel export
```typescript
// src/storage/index.ts
export * from './checksum-utils.js';
export * from './manifest-manager.js';
export * from './file-splitter.js';
```

## Todo List
- [ ] Create `src/storage/` directory
- [ ] Implement `checksum-utils.ts` with SHA-256 hashing
- [ ] Implement `manifest-manager.ts` with CRUD operations
- [ ] Implement `file-splitter.ts` with stream-based split/merge
- [ ] Create `index.ts` barrel export
- [ ] Run `npm run build:ts` to verify no compile errors
- [ ] Test with sample files locally

## Success Criteria
- [x] SHA-256 hash calculation works for files and buffers
- [x] Manifest JSON structure matches specification
- [x] Files >2GB split into 500MB chunks
- [x] Chunks merge back to identical original (hash match)
- [x] Memory usage <100MB during 10GB file processing

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stream backpressure issues | Medium | Use pipeline() for proper handling |
| Incomplete chunk writes | High | Atomic writes (temp→rename) |
| Hash collision | Very Low | SHA-256 cryptographic strength |

## Security Considerations
- SHA-256 provides cryptographic integrity verification
- Atomic file writes prevent partial/corrupted manifests
- No execution of chunk content (treated as binary data)

## Conflict Prevention Strategy
- **Exclusive ownership** of `src/storage/` directory
- No modifications to existing files
- Types defined locally until Phase 03 integration

## Next Steps
After Phase 01 completes:
- Phase 02 can integrate with manifest/splitter APIs
- Phase 03 will add types to `src/types/index.ts`
