// tests/storage/manifest-manager.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { useTempDir } from '../helpers/test-fixtures.js';
import {
  createManifest,
  addChunkToManifest,
  updateChunkMessageId,
  updateManifestStatus,
  saveManifest,
  loadManifest,
  getChunksToUpload,
  isUploadComplete,
  DEFAULT_CHUNK_SIZE
} from '../../src/storage/manifest-manager.js';

const TEST_DIR = useTempDir('manifests');

describe('manifest-manager', () => {
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

    it('should calculate correct chunk count for large file', () => {
      // 10GB file with 3.8GB chunks = 3 chunks
      const manifest = createManifest(
        'large.bin',
        '/large.bin',
        10 * 1024 * 1024 * 1024,
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
      expect(manifest.chunks[1].uploaded).toBe(true);
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

  describe('getChunksToUpload', () => {
    it('should return chunks without uploaded flag', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash');
      manifest = addChunkToManifest(manifest, {
        index: 0, filename: 'chunk-000', size: 512, hash: 'h0', uploaded: true
      });
      manifest = addChunkToManifest(manifest, {
        index: 1, filename: 'chunk-001', size: 512, hash: 'h1', uploaded: false
      });

      const toUpload = getChunksToUpload(manifest);

      expect(toUpload).toHaveLength(1);
      expect(toUpload[0].index).toBe(1);
    });
  });

  describe('isUploadComplete', () => {
    it('should return true when all chunks uploaded', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash', 512);
      manifest = addChunkToManifest(manifest, {
        index: 0, filename: 'chunk-000', size: 512, hash: 'h0', uploaded: true, messageId: 1
      });
      manifest = addChunkToManifest(manifest, {
        index: 1, filename: 'chunk-001', size: 512, hash: 'h1', uploaded: true, messageId: 2
      });

      expect(isUploadComplete(manifest)).toBe(true);
    });

    it('should return false when chunks missing', () => {
      let manifest = createManifest('test.bin', '/test.bin', 1024, 'hash', 512);
      manifest = addChunkToManifest(manifest, {
        index: 0, filename: 'chunk-000', size: 512, hash: 'h0', uploaded: true, messageId: 1
      });

      expect(isUploadComplete(manifest)).toBe(false);
    });
  });
});
