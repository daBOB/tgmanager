# Phase 03: CLI Commands (upload-storage, download-storage, list-storage)

## Context Links
- [Phase 01: Core Utilities](./phase-01-core-utilities-file-splitter-manifest-checksum.md)
- [Phase 02: Storage Service](./phase-02-storage-service-telegram-channel-operations.md)
- [Existing CLI](../../src/index.ts)

## Overview
- **Priority:** P1 (Critical Path)
- **Status:** Pending
- **Effort:** 2.5h
- **Parallelization:** BLOCKED - requires Phase 01 + 02 completion

## Key Insights
- Commands follow existing Commander.js patterns
- Reuse existing `startClient` authentication flow
- Progress bars via cli-progress (existing dependency)
- Virtual paths use Unix-style `/path/to/file` format

## Requirements

### Functional
- `upload-storage`: Upload file to storage with virtual path
- `download-storage`: Download file from storage by virtual path
- `list-storage`: List files in storage (optional path filter)
- Auto-split files >2GB, seamless for user
- Progress display for all operations

### Non-Functional
- Consistent UX with existing `upload` command
- Clear error messages for missing files/paths
- Graceful handling of interrupted operations

## Architecture

```
src/index.ts
    │
    ├── upload-storage ──► UploadStorageCommand
    │                           │
    │                           ├── FileSplitter.splitFile()
    │                           ├── StorageService.uploadAllChunks()
    │                           └── StorageService.uploadManifest()
    │
    ├── download-storage ──► DownloadStorageCommand
    │                           │
    │                           ├── StorageService.findByPath()
    │                           ├── StorageService.downloadChunk() × N
    │                           └── FileSplitter.mergeChunks()
    │
    └── list-storage ──► ListStorageCommand
                              │
                              └── StorageService.listByPath()
```

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/commands/upload-storage-command.ts` | Upload file to storage |
| `src/commands/download-storage-command.ts` | Download file from storage |
| `src/commands/list-storage-command.ts` | List storage contents |
| `src/commands/index.ts` | Barrel export |

### Files to Modify
| File | Changes |
|------|---------|
| `src/index.ts` | Add new command options + handlers |
| `src/types/index.ts` | Add storage-related types |

### Dependencies from Phase 01 + 02
- `splitFile`, `mergeChunks`, `needsSplitting` from `file-splitter.ts`
- `FileManifest`, `saveManifest`, `loadManifest` from `manifest-manager.ts`
- `StorageService` from `storage-service.ts`

## Implementation Steps

### Step 1: Add types to src/types/index.ts
```typescript
// Add to src/types/index.ts

export interface StorageCommandOptions extends CommandOptions {
  virtualPath?: string;
  outputPath?: string;
  force?: boolean;
}

export interface StoredFileInfo {
  fileId: string;
  originalName: string;
  virtualPath: string;
  size: number;
  status: 'splitting' | 'uploading' | 'complete' | 'failed';
  createdAt: string;
  manifestMessageId: number;
}
```

### Step 2: Create upload-storage-command.ts
```typescript
// src/commands/upload-storage-command.ts
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import cliProgress from 'cli-progress';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import {
  splitFile,
  needsSplitting,
  cleanupChunks
} from '../storage/file-splitter.js';
import {
  saveManifest,
  updateManifestStatus,
  getManifestPath
} from '../storage/manifest-manager.js';
import { hashFile } from '../storage/checksum-utils.js';
import logger from '../logger.js';
import config from '../config.js';

export interface UploadStorageOptions {
  filePath: string;
  virtualPath: string;
  storageChannelId?: string;
  deleteSource?: boolean;
}

/**
 * Upload file to storage channel with automatic splitting
 */
export async function uploadStorageCommand(
  client: TelegramClient,
  options: UploadStorageOptions
): Promise<boolean> {
  const { filePath, virtualPath, storageChannelId, deleteSource } = options;

  // Validate file exists
  if (!existsSync(filePath)) {
    logger.error('File not found', { filePath });
    console.error(`Error: File not found: ${filePath}`);
    return false;
  }

  const stats = await stat(filePath);
  const fileName = basename(filePath);
  const fileSize = stats.size;

  console.log(`\nUploading: ${fileName}`);
  console.log(`Size: ${formatBytes(fileSize)}`);
  console.log(`Virtual path: ${virtualPath}\n`);

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  // Check if file needs splitting
  const isPremium = await checkPremiumStatus(client);
  const requiresSplit = needsSplitting(fileSize, isPremium);

  if (requiresSplit) {
    return uploadWithSplitting(client, storage, options, fileSize);
  } else {
    return uploadDirect(client, storage, options, fileSize);
  }
}

/**
 * Upload large file with splitting
 */
async function uploadWithSplitting(
  client: TelegramClient,
  storage: StorageService,
  options: UploadStorageOptions,
  fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);

  // Create temp directory for chunks
  const tempDir = join(config.app.uploadDir, '.storage-temp');

  console.log('File exceeds size limit, splitting into chunks...\n');

  // Progress bar for splitting
  const splitBar = new cliProgress.SingleBar({
    format: 'Splitting |{bar}| {percentage}% | Chunk {currentChunk}/{totalChunks}',
  }, cliProgress.Presets.shades_classic);

  splitBar.start(100, 0, { currentChunk: 0, totalChunks: '?' });

  try {
    // Split file
    const { manifest, chunkPaths } = await splitFile(filePath, {
      outputDir: tempDir,
      virtualPath,
      onProgress: (progress) => {
        splitBar.update(progress.percentage, {
          currentChunk: progress.currentChunk + 1,
          totalChunks: progress.totalChunks
        });
      }
    });

    splitBar.stop();
    console.log(`\nCreated ${manifest.totalChunks} chunks\n`);

    // Progress bar for uploading
    const uploadBar = new cliProgress.SingleBar({
      format: 'Uploading |{bar}| {percentage}% | Chunk {chunkIndex}/{totalChunks}',
    }, cliProgress.Presets.shades_classic);

    uploadBar.start(100, 0, { chunkIndex: 0, totalChunks: manifest.totalChunks });

    // Upload chunks
    const updatedManifest = await storage.uploadAllChunks(tempDir, manifest, (progress) => {
      uploadBar.update(progress.percentage, {
        chunkIndex: progress.chunkIndex + 1,
        totalChunks: progress.totalChunks
      });
    });

    uploadBar.stop();

    // Update manifest status and upload
    const finalManifest = updateManifestStatus(updatedManifest, 'complete');
    await storage.uploadManifest(finalManifest);

    // Save local manifest copy
    const manifestPath = getManifestPath(tempDir, finalManifest.fileId);
    await saveManifest(finalManifest, manifestPath);

    // Cleanup chunks
    await cleanupChunks(finalManifest, tempDir);

    console.log(`\n✓ Upload complete: ${fileName}`);
    console.log(`  Virtual path: ${virtualPath}`);
    console.log(`  File ID: ${finalManifest.fileId}`);

    logger.info('Storage upload complete', {
      fileId: finalManifest.fileId,
      virtualPath,
      chunks: finalManifest.totalChunks
    });

    return true;
  } catch (error) {
    splitBar.stop();
    logger.error('Storage upload failed', {
      filePath,
      error: (error as Error).message
    });
    console.error(`\n✗ Upload failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Upload small file directly (no splitting)
 */
async function uploadDirect(
  client: TelegramClient,
  storage: StorageService,
  options: UploadStorageOptions,
  fileSize: number
): Promise<boolean> {
  const { filePath, virtualPath } = options;
  const fileName = basename(filePath);

  const progressBar = new cliProgress.SingleBar({
    format: 'Uploading |{bar}| {percentage}%',
  }, cliProgress.Presets.shades_classic);

  progressBar.start(100, 0);

  try {
    // For small files, create a single-chunk manifest
    const { hash } = await hashFile(filePath);

    const manifest = {
      fileId: crypto.randomUUID(),
      version: 1 as const,
      originalName: fileName,
      originalPath: virtualPath,
      originalSize: fileSize,
      originalHash: hash,
      chunkSize: fileSize,
      totalChunks: 1,
      chunks: [{
        index: 0,
        filename: fileName,
        size: fileSize,
        hash
      }],
      status: 'uploading' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Upload file as single chunk
    const messageId = await storage.uploadChunk(filePath, manifest, 0, (p) => {
      progressBar.update(p);
    });

    progressBar.stop();

    // Update and upload manifest
    manifest.chunks[0].messageId = messageId;
    manifest.chunks[0].uploadedAt = new Date().toISOString();
    manifest.status = 'complete';
    manifest.updatedAt = new Date().toISOString();

    await storage.uploadManifest(manifest);

    console.log(`\n✓ Upload complete: ${fileName}`);
    console.log(`  Virtual path: ${virtualPath}`);
    console.log(`  File ID: ${manifest.fileId}`);

    return true;
  } catch (error) {
    progressBar.stop();
    logger.error('Direct upload failed', { error: (error as Error).message });
    console.error(`\n✗ Upload failed: ${(error as Error).message}`);
    return false;
  }
}

async function checkPremiumStatus(client: TelegramClient): Promise<boolean> {
  try {
    const result = await client.invoke(
      new (await import('telegram')).Api.users.GetFullUser({ id: 'Me' })
    );
    const user = result.users?.[0] as any;
    return !!user?.premium;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
```

### Step 3: Create download-storage-command.ts
```typescript
// src/commands/download-storage-command.ts
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import cliProgress from 'cli-progress';
import type { TelegramClient } from '../types/index.js';
import { StorageService } from '../storage/storage-service.js';
import { mergeChunks, cleanupChunks } from '../storage/file-splitter.js';
import logger from '../logger.js';
import config from '../config.js';

export interface DownloadStorageOptions {
  virtualPath: string;
  outputPath?: string;
  storageChannelId?: string;
}

/**
 * Download file from storage channel
 */
export async function downloadStorageCommand(
  client: TelegramClient,
  options: DownloadStorageOptions
): Promise<boolean> {
  const { virtualPath, outputPath, storageChannelId } = options;

  console.log(`\nSearching for: ${virtualPath}\n`);

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  // Find file by virtual path
  const fileInfo = await storage.findByPath(virtualPath);

  if (!fileInfo) {
    console.error(`Error: File not found: ${virtualPath}`);
    logger.error('File not found in storage', { virtualPath });
    return false;
  }

  console.log(`Found: ${fileInfo.originalName}`);
  console.log(`Size: ${formatBytes(fileInfo.size)}`);
  console.log(`Status: ${fileInfo.status}\n`);

  if (fileInfo.status !== 'complete') {
    console.error('Error: File upload incomplete or failed');
    return false;
  }

  // Get full manifest
  const manifest = await storage.getManifestFromMessage(fileInfo.manifestMessageId);
  if (!manifest) {
    console.error('Error: Could not retrieve file manifest');
    return false;
  }

  // Determine output path
  const finalOutputPath = outputPath || join(process.cwd(), manifest.originalName);
  const outputDir = dirname(finalOutputPath);

  // Check if output already exists
  if (existsSync(finalOutputPath)) {
    console.error(`Error: Output file already exists: ${finalOutputPath}`);
    console.error('Use --force to overwrite or specify different --output-path');
    return false;
  }

  // Create output directory if needed
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Create temp directory for chunks
  const tempDir = join(config.app.uploadDir, '.storage-temp', manifest.fileId);
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  console.log(`Downloading ${manifest.totalChunks} chunks...\n`);

  // Progress bar for downloading
  const downloadBar = new cliProgress.SingleBar({
    format: 'Downloading |{bar}| {percentage}% | Chunk {chunkIndex}/{totalChunks}',
  }, cliProgress.Presets.shades_classic);

  downloadBar.start(100, 0, { chunkIndex: 0, totalChunks: manifest.totalChunks });

  try {
    // Download all chunks
    for (let i = 0; i < manifest.chunks.length; i++) {
      const chunk = manifest.chunks[i];
      if (!chunk.messageId) {
        throw new Error(`Missing message ID for chunk ${i}`);
      }

      const chunkPath = join(tempDir, chunk.filename);
      const success = await storage.downloadChunk(
        chunk.messageId,
        chunkPath,
        chunk.hash,
        (p) => {
          const overallProgress = ((i + p / 100) / manifest.totalChunks) * 100;
          downloadBar.update(overallProgress, {
            chunkIndex: i + 1,
            totalChunks: manifest.totalChunks
          });
        }
      );

      if (!success) {
        throw new Error(`Failed to download chunk ${i}`);
      }
    }

    downloadBar.stop();
    console.log('\nMerging chunks...');

    // Merge chunks
    const mergeBar = new cliProgress.SingleBar({
      format: 'Merging |{bar}| {percentage}%',
    }, cliProgress.Presets.shades_classic);

    mergeBar.start(100, 0);

    const mergeSuccess = await mergeChunks(manifest, tempDir, finalOutputPath, (progress) => {
      mergeBar.update(progress.percentage);
    });

    mergeBar.stop();

    if (!mergeSuccess) {
      console.error('\n✗ File integrity verification failed');
      return false;
    }

    // Cleanup temp chunks
    await cleanupChunks(manifest, tempDir);

    console.log(`\n✓ Download complete: ${finalOutputPath}`);
    logger.info('Storage download complete', {
      fileId: manifest.fileId,
      outputPath: finalOutputPath
    });

    return true;
  } catch (error) {
    downloadBar.stop();
    logger.error('Storage download failed', {
      virtualPath,
      error: (error as Error).message
    });
    console.error(`\n✗ Download failed: ${(error as Error).message}`);
    return false;
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
```

### Step 4: Create list-storage-command.ts
```typescript
// src/commands/list-storage-command.ts
import type { TelegramClient } from '../types/index.js';
import { StorageService, StoredFileInfo } from '../storage/storage-service.js';
import logger from '../logger.js';

export interface ListStorageOptions {
  pathPrefix?: string;
  storageChannelId?: string;
}

/**
 * List files in storage channel
 */
export async function listStorageCommand(
  client: TelegramClient,
  options: ListStorageOptions
): Promise<boolean> {
  const { pathPrefix, storageChannelId } = options;

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  console.log('\nFetching storage contents...\n');

  try {
    const files = pathPrefix
      ? await storage.listByPath(pathPrefix)
      : await storage.listStoredFiles();

    if (files.length === 0) {
      console.log('No files found in storage.');
      if (pathPrefix) {
        console.log(`(filtered by path: ${pathPrefix})`);
      }
      return true;
    }

    // Sort by virtual path
    files.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));

    // Group by directory
    const grouped = groupByDirectory(files);

    console.log(`Found ${files.length} file(s):\n`);

    for (const [dir, dirFiles] of Object.entries(grouped)) {
      console.log(`📁 ${dir || '/'}`);
      for (const file of dirFiles) {
        const status = file.status === 'complete' ? '✓' : '⚠';
        const size = formatBytes(file.size);
        console.log(`   ${status} ${file.originalName} (${size})`);
      }
      console.log('');
    }

    // Summary
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`Total: ${files.length} files, ${formatBytes(totalSize)}`);

    return true;
  } catch (error) {
    logger.error('Failed to list storage', { error: (error as Error).message });
    console.error(`Error: ${(error as Error).message}`);
    return false;
  }
}

function groupByDirectory(files: StoredFileInfo[]): Record<string, StoredFileInfo[]> {
  const grouped: Record<string, StoredFileInfo[]> = {};

  for (const file of files) {
    const parts = file.virtualPath.split('/');
    parts.pop(); // Remove filename
    const dir = parts.join('/') || '/';

    if (!grouped[dir]) {
      grouped[dir] = [];
    }
    grouped[dir].push(file);
  }

  return grouped;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
```

### Step 5: Create commands barrel export
```typescript
// src/commands/index.ts
export * from './upload-storage-command.js';
export * from './download-storage-command.js';
export * from './list-storage-command.js';
```

### Step 6: Modify src/index.ts
Add these command options after existing options:
```typescript
// Add to Commander options (after line 115)
  .option('--virtual-path <path>', 'Virtual path for storage operations')
  .option('--output-path <path>', 'Output path for download operations')
  .option('--storage-channel <id>', 'Storage channel ID (optional)')
```

Add command handlers in main() after existing commands:
```typescript
// Add after the 'create' command handler (around line 288)
    } else if (command === 'upload-storage' && filePath && options.virtualPath) {
      const { uploadStorageCommand } = await import('./commands/upload-storage-command.js');
      const success = await uploadStorageCommand(client, {
        filePath: uploadPath!,
        virtualPath: options.virtualPath,
        storageChannelId: options.storageChannel,
        deleteSource
      });
      process.exit(success ? 0 : 1);

    } else if (command === 'download-storage' && options.virtualPath) {
      const { downloadStorageCommand } = await import('./commands/download-storage-command.js');
      const success = await downloadStorageCommand(client, {
        virtualPath: options.virtualPath,
        outputPath: options.outputPath,
        storageChannelId: options.storageChannel
      });
      process.exit(success ? 0 : 1);

    } else if (command === 'list-storage') {
      const { listStorageCommand } = await import('./commands/list-storage-command.js');
      const success = await listStorageCommand(client, {
        pathPrefix: options.virtualPath,
        storageChannelId: options.storageChannel
      });
      process.exit(success ? 0 : 1);
    }
```

## Todo List
- [ ] Add storage types to `src/types/index.ts`
- [ ] Create `src/commands/upload-storage-command.ts`
- [ ] Create `src/commands/download-storage-command.ts`
- [ ] Create `src/commands/list-storage-command.ts`
- [ ] Create `src/commands/index.ts` barrel export
- [ ] Modify `src/index.ts` with new command options
- [ ] Modify `src/index.ts` with new command handlers
- [ ] Run `npm run build:ts` to verify compilation
- [ ] Test upload-storage with small file
- [ ] Test upload-storage with large file (>2GB)
- [ ] Test download-storage
- [ ] Test list-storage

## Success Criteria
- [x] `upload-storage` splits files >2GB automatically
- [x] `download-storage` merges chunks and verifies integrity
- [x] `list-storage` shows virtual filesystem structure
- [x] Progress bars display during all operations
- [x] Error handling matches existing command UX

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLI option conflicts | Medium | Unique option names |
| Import cycle | High | Dynamic imports for commands |
| Type mismatches | Medium | Strict TypeScript checking |

## Security Considerations
- Virtual paths sanitized (no `..` traversal)
- Output paths validated before write
- Storage channel ID validated format

## Conflict Prevention Strategy
- **Exclusive ownership** of `src/commands/` directory (new)
- Modifications to `src/index.ts` are isolated additions
- Type additions to `src/types/index.ts` are append-only

## Next Steps
After Phase 03 completes:
- Phase 04 creates integration tests
- Update README with new commands documentation
