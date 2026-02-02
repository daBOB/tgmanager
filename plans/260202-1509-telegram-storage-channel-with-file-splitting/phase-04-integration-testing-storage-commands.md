# Phase 04: Integration Testing (Storage Commands)

## Context Links
- [Phase 01: Core Utilities](./phase-01-core-utilities-file-splitter-manifest-checksum.md)
- [Phase 02: Storage Service](./phase-02-storage-service-telegram-channel-operations.md)
- [Phase 03: CLI Commands](./phase-03-cli-commands-upload-download-list-storage.md)

## Overview
- **Priority:** P2 (Quality Gate)
- **Status:** Pending
- **Effort:** 1.5h
- **Parallelization:** BLOCKED - requires Phase 03 completion

## Key Insights
- Unit tests for pure functions (splitter, checksum, manifest)
- Integration tests require mock Telegram client
- E2E tests optional (require real Telegram account)
- Focus on critical paths: split → upload → download → merge → verify

## Requirements

### Functional
- Unit tests for checksum utilities
- Unit tests for manifest manager
- Unit tests for file splitter (mock fs)
- Integration tests for storage service (mock client)
- CLI command tests (mock dependencies)

### Non-Functional
- Test coverage >80% for new code
- Tests run in <30 seconds
- No real Telegram API calls in CI

## Architecture

```
tests/
├── storage/
│   ├── checksum-utils.test.ts       # Unit tests
│   ├── manifest-manager.test.ts     # Unit tests
│   ├── file-splitter.test.ts        # Unit tests with temp files
│   └── storage-service.test.ts      # Integration with mock client
└── commands/
    ├── upload-storage.test.ts       # Command tests
    ├── download-storage.test.ts     # Command tests
    └── list-storage.test.ts         # Command tests
```

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `tests/storage/checksum-utils.test.ts` | SHA-256 hashing tests |
| `tests/storage/manifest-manager.test.ts` | Manifest CRUD tests |
| `tests/storage/file-splitter.test.ts` | Split/merge tests |
| `tests/storage/storage-service.test.ts` | Telegram ops tests |
| `tests/mocks/telegram-client-mock.ts` | Mock TelegramClient |

### Files NOT Modified
- All source files (testing only)

## Implementation Steps

### Step 1: Create Telegram client mock
```typescript
// tests/mocks/telegram-client-mock.ts
import { EventEmitter } from 'events';

export interface MockMessage {
  id: number;
  message?: string;
  media?: any;
}

export class MockTelegramClient extends EventEmitter {
  private messages: Map<number, MockMessage> = new Map();
  private nextMessageId = 1;
  private uploadedFiles: Map<number, Buffer> = new Map();

  async invoke(request: any): Promise<any> {
    const className = request.className || request.constructor?.name;

    if (className === 'GetFullUser') {
      return {
        users: [{ premium: false }]
      };
    }

    if (className === 'CreateChannel') {
      return {
        chats: [{
          id: { toJSNumber: () => 123456789 }
        }]
      };
    }

    return {};
  }

  async getDialogs(options?: any): Promise<any[]> {
    return [];
  }

  async sendFile(chatId: string, options: any): Promise<MockMessage> {
    const messageId = this.nextMessageId++;
    const message: MockMessage = {
      id: messageId,
      media: { document: true }
    };

    // Store file content if it's a buffer
    if (options.file instanceof Buffer) {
      this.uploadedFiles.set(messageId, options.file);
    }

    this.messages.set(messageId, message);

    // Simulate progress
    if (options.progressCallback) {
      options.progressCallback(0.5);
      options.progressCallback(1.0);
    }

    return message;
  }

  async sendMessage(chatId: string, options: any): Promise<MockMessage> {
    const messageId = this.nextMessageId++;
    const message: MockMessage = {
      id: messageId,
      message: options.message
    };
    this.messages.set(messageId, message);
    return message;
  }

  async getMessages(chatId: string, options: any): Promise<MockMessage[]> {
    if (options.ids) {
      return options.ids
        .map((id: number) => this.messages.get(id))
        .filter(Boolean);
    }

    if (options.search) {
      return Array.from(this.messages.values())
        .filter(m => m.message?.includes(options.search));
    }

    return Array.from(this.messages.values()).slice(0, options.limit || 100);
  }

  async downloadMedia(message: MockMessage, options?: any): Promise<Buffer | null> {
    const buffer = this.uploadedFiles.get(message.id);

    if (buffer && options?.progressCallback) {
      options.progressCallback(0.5);
      options.progressCallback(1.0);
    }

    return buffer || Buffer.from('mock-content');
  }

  async deleteMessages(chatId: string, ids: number[], options?: any): Promise<void> {
    for (const id of ids) {
      this.messages.delete(id);
      this.uploadedFiles.delete(id);
    }
  }

  // Test helpers
  _reset(): void {
    this.messages.clear();
    this.uploadedFiles.clear();
    this.nextMessageId = 1;
  }

  _getMessageCount(): number {
    return this.messages.size;
  }
}
```

### Step 2: Create checksum-utils.test.ts
```typescript
// tests/storage/checksum-utils.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  hashFile,
  hashChunk,
  verifyChunk,
  verifyFile
} from '../../src/storage/checksum-utils.js';

const TEST_DIR = join(process.cwd(), 'tests', '.temp');

describe('checksum-utils', () => {
  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    // Cleanup handled by individual tests
  });

  describe('hashChunk', () => {
    it('should hash a buffer correctly', () => {
      const data = Buffer.from('hello world');
      const hash = hashChunk(data);

      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('should produce different hashes for different data', () => {
      const hash1 = hashChunk(Buffer.from('data1'));
      const hash2 = hashChunk(Buffer.from('data2'));

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash for same data', () => {
      const data = Buffer.from('consistent data');
      const hash1 = hashChunk(data);
      const hash2 = hashChunk(data);

      expect(hash1).toBe(hash2);
    });
  });

  describe('verifyChunk', () => {
    it('should return true for matching hash', () => {
      const data = Buffer.from('test data');
      const hash = hashChunk(data);

      expect(verifyChunk(data, hash)).toBe(true);
    });

    it('should return false for non-matching hash', () => {
      const data = Buffer.from('test data');

      expect(verifyChunk(data, 'invalid-hash')).toBe(false);
    });
  });

  describe('hashFile', () => {
    it('should hash a file correctly', async () => {
      const testFile = join(TEST_DIR, 'hash-test.txt');
      await writeFile(testFile, 'file content for hashing');

      const result = await hashFile(testFile);

      expect(result.algorithm).toBe('sha256');
      expect(result.hash).toHaveLength(64);

      await unlink(testFile);
    });

    it('should produce consistent hashes', async () => {
      const testFile = join(TEST_DIR, 'consistent-hash.txt');
      await writeFile(testFile, 'consistent content');

      const result1 = await hashFile(testFile);
      const result2 = await hashFile(testFile);

      expect(result1.hash).toBe(result2.hash);

      await unlink(testFile);
    });
  });

  describe('verifyFile', () => {
    it('should verify file integrity', async () => {
      const testFile = join(TEST_DIR, 'verify-test.txt');
      await writeFile(testFile, 'verify this content');

      const { hash } = await hashFile(testFile);
      const isValid = await verifyFile(testFile, hash);

      expect(isValid).toBe(true);

      await unlink(testFile);
    });

    it('should detect corrupted file', async () => {
      const testFile = join(TEST_DIR, 'corrupt-test.txt');
      await writeFile(testFile, 'original content');

      const { hash } = await hashFile(testFile);

      // Modify file
      await writeFile(testFile, 'modified content');

      const isValid = await verifyFile(testFile, hash);

      expect(isValid).toBe(false);

      await unlink(testFile);
    });
  });
});
```

### Step 3: Create manifest-manager.test.ts
```typescript
// tests/storage/manifest-manager.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  createManifest,
  addChunkToManifest,
  updateChunkMessageId,
  updateManifestStatus,
  saveManifest,
  loadManifest,
  DEFAULT_CHUNK_SIZE
} from '../../src/storage/manifest-manager.js';

const TEST_DIR = join(process.cwd(), 'tests', '.temp', 'manifests');

describe('manifest-manager', () => {
  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true });
    }
  });

  describe('createManifest', () => {
    it('should create manifest with correct structure', () => {
      const manifest = createManifest(
        'test.bin',
        '/files/test.bin',
        1024 * 1024 * 100, // 100MB
        'abc123hash'
      );

      expect(manifest.fileId).toBeDefined();
      expect(manifest.version).toBe(1);
      expect(manifest.originalName).toBe('test.bin');
      expect(manifest.originalPath).toBe('/files/test.bin');
      expect(manifest.originalSize).toBe(104857600);
      expect(manifest.originalHash).toBe('abc123hash');
      expect(manifest.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
      expect(manifest.status).toBe('splitting');
      expect(manifest.chunks).toEqual([]);
    });

    it('should calculate correct chunk count', () => {
      // 1.5GB file with 500MB chunks = 3 chunks
      const manifest = createManifest(
        'large.bin',
        '/large.bin',
        1.5 * 1024 * 1024 * 1024,
        'hash123'
      );

      expect(manifest.totalChunks).toBe(3);
    });

    it('should use custom chunk size', () => {
      const customChunkSize = 100 * 1024 * 1024; // 100MB
      const manifest = createManifest(
        'custom.bin',
        '/custom.bin',
        500 * 1024 * 1024, // 500MB
        'hash',
        customChunkSize
      );

      expect(manifest.chunkSize).toBe(customChunkSize);
      expect(manifest.totalChunks).toBe(5);
    });
  });

  describe('addChunkToManifest', () => {
    it('should add chunk info', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash');

      manifest = addChunkToManifest(manifest, {
        index: 0,
        filename: 'chunk-000',
        size: 512,
        hash: 'chunk0hash'
      });

      expect(manifest.chunks).toHaveLength(1);
      expect(manifest.chunks[0].index).toBe(0);
      expect(manifest.chunks[0].filename).toBe('chunk-000');
    });

    it('should preserve existing chunks', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash');

      manifest = addChunkToManifest(manifest, {
        index: 0, filename: 'chunk-000', size: 512, hash: 'h0'
      });
      manifest = addChunkToManifest(manifest, {
        index: 1, filename: 'chunk-001', size: 512, hash: 'h1'
      });

      expect(manifest.chunks).toHaveLength(2);
    });
  });

  describe('updateChunkMessageId', () => {
    it('should update specific chunk message ID', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash');
      manifest = addChunkToManifest(manifest, {
        index: 0, filename: 'chunk-000', size: 512, hash: 'h0'
      });
      manifest = addChunkToManifest(manifest, {
        index: 1, filename: 'chunk-001', size: 512, hash: 'h1'
      });

      manifest = updateChunkMessageId(manifest, 1, 12345);

      expect(manifest.chunks[0].messageId).toBeUndefined();
      expect(manifest.chunks[1].messageId).toBe(12345);
      expect(manifest.chunks[1].uploadedAt).toBeDefined();
    });
  });

  describe('updateManifestStatus', () => {
    it('should update status', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash');

      manifest = updateManifestStatus(manifest, 'uploading');
      expect(manifest.status).toBe('uploading');

      manifest = updateManifestStatus(manifest, 'complete');
      expect(manifest.status).toBe('complete');
    });
  });

  describe('saveManifest / loadManifest', () => {
    it('should save and load manifest', async () => {
      const manifest = createManifest('persist.bin', '/persist.bin', 1024, 'hash');
      const filePath = join(TEST_DIR, `${manifest.fileId}.json`);

      await saveManifest(manifest, filePath);
      const loaded = await loadManifest(filePath);

      expect(loaded).not.toBeNull();
      expect(loaded?.fileId).toBe(manifest.fileId);
      expect(loaded?.originalName).toBe(manifest.originalName);
    });

    it('should return null for non-existent file', async () => {
      const loaded = await loadManifest(join(TEST_DIR, 'nonexistent.json'));
      expect(loaded).toBeNull();
    });
  });
});
```

### Step 4: Create file-splitter.test.ts
```typescript
// tests/storage/file-splitter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import {
  splitFile,
  mergeChunks,
  needsSplitting,
  getChunkFilename
} from '../../src/storage/file-splitter.js';
import { hashFile } from '../../src/storage/checksum-utils.js';

const TEST_DIR = join(process.cwd(), 'tests', '.temp', 'splitter');
const CHUNK_SIZE = 1024 * 10; // 10KB for testing

describe('file-splitter', () => {
  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true });
    }
  });

  describe('getChunkFilename', () => {
    it('should generate padded chunk names', () => {
      expect(getChunkFilename('abc123', 0)).toBe('abc123-chunk-000');
      expect(getChunkFilename('abc123', 5)).toBe('abc123-chunk-005');
      expect(getChunkFilename('abc123', 99)).toBe('abc123-chunk-099');
    });
  });

  describe('needsSplitting', () => {
    it('should return true for files exceeding 2GB (regular)', () => {
      const size2_5GB = 2.5 * 1024 * 1024 * 1024;
      expect(needsSplitting(size2_5GB, false)).toBe(true);
    });

    it('should return false for files under 2GB (regular)', () => {
      const size1GB = 1 * 1024 * 1024 * 1024;
      expect(needsSplitting(size1GB, false)).toBe(false);
    });

    it('should use 4GB limit for premium', () => {
      const size3GB = 3 * 1024 * 1024 * 1024;
      expect(needsSplitting(size3GB, true)).toBe(false);

      const size5GB = 5 * 1024 * 1024 * 1024;
      expect(needsSplitting(size5GB, true)).toBe(true);
    });
  });

  describe('splitFile', () => {
    it('should split file into chunks', async () => {
      // Create 25KB test file (will split into 3 chunks with 10KB size)
      const testFile = join(TEST_DIR, 'split-test.bin');
      const outputDir = join(TEST_DIR, 'chunks');
      const testData = crypto.randomBytes(25 * 1024);

      await writeFile(testFile, testData);

      const result = await splitFile(testFile, {
        chunkSize: CHUNK_SIZE,
        outputDir,
        virtualPath: '/test/split-test.bin'
      });

      expect(result.manifest.totalChunks).toBe(3);
      expect(result.chunkPaths).toHaveLength(3);
      expect(result.manifest.originalSize).toBe(25 * 1024);

      // Verify chunks exist
      for (const chunkPath of result.chunkPaths) {
        expect(existsSync(chunkPath)).toBe(true);
      }
    });

    it('should report progress during split', async () => {
      const testFile = join(TEST_DIR, 'progress-test.bin');
      const outputDir = join(TEST_DIR, 'progress-chunks');
      await writeFile(testFile, crypto.randomBytes(30 * 1024));

      const progressReports: number[] = [];

      await splitFile(testFile, {
        chunkSize: CHUNK_SIZE,
        outputDir,
        virtualPath: '/test/progress.bin',
        onProgress: (p) => progressReports.push(p.percentage)
      });

      expect(progressReports.length).toBeGreaterThan(0);
      expect(progressReports[progressReports.length - 1]).toBe(100);
    });
  });

  describe('mergeChunks', () => {
    it('should merge chunks back to original', async () => {
      // Create and split file
      const testFile = join(TEST_DIR, 'merge-original.bin');
      const outputDir = join(TEST_DIR, 'merge-chunks');
      const mergedFile = join(TEST_DIR, 'merge-result.bin');
      const testData = crypto.randomBytes(25 * 1024);

      await writeFile(testFile, testData);
      const { hash: originalHash } = await hashFile(testFile);

      const { manifest } = await splitFile(testFile, {
        chunkSize: CHUNK_SIZE,
        outputDir,
        virtualPath: '/test/merge.bin'
      });

      // Merge chunks
      const success = await mergeChunks(manifest, outputDir, mergedFile);

      expect(success).toBe(true);

      // Verify merged file matches original
      const { hash: mergedHash } = await hashFile(mergedFile);
      expect(mergedHash).toBe(originalHash);
    });

    it('should fail merge with corrupted chunk', async () => {
      const testFile = join(TEST_DIR, 'corrupt-original.bin');
      const outputDir = join(TEST_DIR, 'corrupt-chunks');
      const mergedFile = join(TEST_DIR, 'corrupt-result.bin');

      await writeFile(testFile, crypto.randomBytes(25 * 1024));

      const { manifest, chunkPaths } = await splitFile(testFile, {
        chunkSize: CHUNK_SIZE,
        outputDir,
        virtualPath: '/test/corrupt.bin'
      });

      // Corrupt first chunk
      await writeFile(chunkPaths[0], crypto.randomBytes(CHUNK_SIZE));

      // Merge should fail integrity check
      const success = await mergeChunks(manifest, outputDir, mergedFile);

      expect(success).toBe(false);
    });
  });
});
```

### Step 5: Create storage-service.test.ts
```typescript
// tests/storage/storage-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTelegramClient } from '../mocks/telegram-client-mock.js';
import { StorageService } from '../../src/storage/storage-service.js';
import type { FileManifest } from '../../src/storage/manifest-manager.js';

describe('StorageService', () => {
  let client: MockTelegramClient;
  let storage: StorageService;

  beforeEach(() => {
    client = new MockTelegramClient();
    storage = new StorageService(client as any);
  });

  describe('initializeStorageChannel', () => {
    it('should create new channel if none exists', async () => {
      const channelId = await storage.initializeStorageChannel();

      expect(channelId).toBe('-100123456789');
    });

    it('should reuse configured channel ID', async () => {
      const configuredStorage = new StorageService(client as any, {
        storageChannelId: '-100999888777'
      });

      const channelId = await configuredStorage.initializeStorageChannel();

      expect(channelId).toBe('-100999888777');
    });
  });

  describe('uploadManifest', () => {
    it('should upload manifest as JSON message', async () => {
      await storage.initializeStorageChannel();

      const manifest: FileManifest = {
        fileId: 'test-file-id',
        version: 1,
        originalName: 'test.bin',
        originalPath: '/test/test.bin',
        originalSize: 1024,
        originalHash: 'abc123',
        chunkSize: 512,
        totalChunks: 2,
        chunks: [],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const messageId = await storage.uploadManifest(manifest);

      expect(messageId).toBeGreaterThan(0);
    });
  });

  describe('getManifestFromMessage', () => {
    it('should retrieve and parse manifest', async () => {
      await storage.initializeStorageChannel();

      const manifest: FileManifest = {
        fileId: 'retrieve-test',
        version: 1,
        originalName: 'retrieve.bin',
        originalPath: '/retrieve.bin',
        originalSize: 2048,
        originalHash: 'def456',
        chunkSize: 1024,
        totalChunks: 2,
        chunks: [],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const messageId = await storage.uploadManifest(manifest);
      const retrieved = await storage.getManifestFromMessage(messageId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.fileId).toBe('retrieve-test');
      expect(retrieved?.originalName).toBe('retrieve.bin');
    });
  });

  describe('listStoredFiles', () => {
    it('should list uploaded manifests', async () => {
      await storage.initializeStorageChannel();

      // Upload multiple manifests
      const manifest1: FileManifest = {
        fileId: 'file1',
        version: 1,
        originalName: 'file1.bin',
        originalPath: '/docs/file1.bin',
        originalSize: 1024,
        originalHash: 'h1',
        chunkSize: 1024,
        totalChunks: 1,
        chunks: [],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const manifest2: FileManifest = {
        fileId: 'file2',
        version: 1,
        originalName: 'file2.bin',
        originalPath: '/docs/file2.bin',
        originalSize: 2048,
        originalHash: 'h2',
        chunkSize: 1024,
        totalChunks: 2,
        chunks: [],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await storage.uploadManifest(manifest1);
      await storage.uploadManifest(manifest2);

      const files = await storage.listStoredFiles();

      expect(files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteStoredFile', () => {
    it('should delete manifest and chunks', async () => {
      await storage.initializeStorageChannel();

      const manifest: FileManifest = {
        fileId: 'delete-test',
        version: 1,
        originalName: 'delete.bin',
        originalPath: '/delete.bin',
        originalSize: 1024,
        originalHash: 'hash',
        chunkSize: 1024,
        totalChunks: 1,
        chunks: [{ index: 0, filename: 'chunk-000', size: 1024, hash: 'h', messageId: 100 }],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const messageId = await storage.uploadManifest(manifest);
      const deleted = await storage.deleteStoredFile(messageId);

      expect(deleted).toBe(true);
    });
  });
});
```

## Todo List
- [ ] Create `tests/mocks/telegram-client-mock.ts`
- [ ] Create `tests/storage/checksum-utils.test.ts`
- [ ] Create `tests/storage/manifest-manager.test.ts`
- [ ] Create `tests/storage/file-splitter.test.ts`
- [ ] Create `tests/storage/storage-service.test.ts`
- [ ] Run `npm test` to verify all tests pass
- [ ] Check coverage report (>80% target)
- [ ] Fix any failing tests

## Success Criteria
- [x] All unit tests pass
- [x] All integration tests pass
- [x] Code coverage >80% for storage module
- [x] No flaky tests (consistent results)
- [x] Tests complete in <30 seconds

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mock doesn't match real API | High | Document differences |
| Temp file cleanup fails | Low | Use vitest afterAll hooks |
| Large file tests slow | Medium | Use small test data |

## Security Considerations
- No real credentials in tests
- Temp files cleaned up after tests
- Mock client isolated from real API

## Conflict Prevention Strategy
- **Exclusive ownership** of `tests/` directory additions
- No modifications to source files
- Mock client self-contained

## Next Steps
After Phase 04 completes:
- Update README.md with new commands documentation
- Create usage examples
- Consider E2E tests with real account (manual)
