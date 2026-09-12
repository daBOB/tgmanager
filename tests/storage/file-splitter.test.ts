// tests/storage/file-splitter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
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
import { makeTempDir } from '../helpers/test-fixtures.js';

const TEST_DIR = makeTempDir('splitter');
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
    // Universal ~3.7 GB threshold (DEFAULT_CHUNK_SIZE): Telegram rejects files near
    // the 4 GB API limit even for premium accounts, so account type does not matter.
    it('should return false for a file well under the chunk size', () => {
      const size1GB = 1 * 1024 * 1024 * 1024;
      expect(needsSplitting(size1GB)).toBe(false);
    });

    it('should return false for a file just under the chunk size', () => {
      const size3GB = 3 * 1024 * 1024 * 1024;
      expect(needsSplitting(size3GB)).toBe(false);
    });

    it('should return true for a file exceeding the chunk size', () => {
      const size5GB = 5 * 1024 * 1024 * 1024;
      expect(needsSplitting(size5GB)).toBe(true);
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
