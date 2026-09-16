// tests/storage/checksum-utils.test.ts
import { describe, it, expect } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../helpers/test-fixtures.js';
import {
  hashFile,
  hashChunk,
  verifyChunk,
  verifyFile
} from '../../src/storage/checksum-utils.js';

const TEST_DIR = useTempDir('checksum');

describe('checksum-utils', () => {
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
