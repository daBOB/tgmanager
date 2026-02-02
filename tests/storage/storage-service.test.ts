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

  describe('findByPath', () => {
    it('should find file by exact virtual path', async () => {
      await storage.initializeStorageChannel();

      const manifest: FileManifest = {
        fileId: 'find-test',
        version: 1,
        originalName: 'findme.bin',
        originalPath: '/specific/path/findme.bin',
        originalSize: 1024,
        originalHash: 'hash',
        chunkSize: 1024,
        totalChunks: 1,
        chunks: [],
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await storage.uploadManifest(manifest);
      const found = await storage.findByPath('/specific/path/findme.bin');

      expect(found).not.toBeNull();
      expect(found?.originalName).toBe('findme.bin');
    });

    it('should return null for non-existent path', async () => {
      await storage.initializeStorageChannel();

      const found = await storage.findByPath('/nonexistent/path.bin');

      expect(found).toBeNull();
    });
  });

  describe('listByPath', () => {
    it('should filter files by path prefix', async () => {
      await storage.initializeStorageChannel();

      const manifest1: FileManifest = {
        fileId: 'docs1',
        version: 1,
        originalName: 'doc1.bin',
        originalPath: '/documents/doc1.bin',
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
        fileId: 'img1',
        version: 1,
        originalName: 'img1.bin',
        originalPath: '/images/img1.bin',
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

      const docsOnly = await storage.listByPath('/documents');

      expect(docsOnly.every(f => f.virtualPath.startsWith('/documents'))).toBe(true);
    });
  });
});
