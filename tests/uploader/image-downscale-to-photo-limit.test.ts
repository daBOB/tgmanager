import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { makeTempDir } from '../helpers/test-fixtures.js';

// Miniature limits stand in for Telegram's real ones so the fixtures can be
// small and the suite stays fast. The behaviour under test is the policy, not
// the constants.
const LIMITS = {
  maxDimension: 5000,
  maxCombinedDimensions: 9000,
  maxPhotoBytes: 4_000,
  photoMaxDimension: 32,
  photoJpegQuality: 80,
  supportedFormats: ['.jpg', '.jpeg', '.png', '.gif'],
};

vi.mock('../../src/config.js', () => ({
  default: { fileProcessing: { image: LIMITS } },
}));

const { uploadImageWithResize } = await import('../../src/uploader/image-resize-and-upload.js');

let tempDir: string;

/** Random noise compresses badly, so this reliably produces a large PNG. */
async function makeNoisyPng(name: string, size: number): Promise<string> {
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  const path = join(tempDir, name);
  await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toFile(path);
  return path;
}

async function makeTinyPng(name: string): Promise<string> {
  const path = join(tempDir, name);
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png().toFile(path);
  return path;
}

beforeEach(() => { tempDir = makeTempDir('image-downscale'); });
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('images above the photo size limit', () => {
  it('downscales and sends as a photo rather than a document', async () => {
    const original = await makeNoisyPng('big.png', 256);
    expect(statSync(original).size).toBeGreaterThan(LIMITS.maxPhotoBytes);

    let sentPath = '';
    let sentAsDocument = true;
    await uploadImageWithResize(original, (path, forceDocument) => {
      sentPath = path;
      sentAsDocument = forceDocument;
      // Captured before the caller removes the temp file.
      expect(statSync(path).size).toBeLessThanOrEqual(LIMITS.maxPhotoBytes);
      return Promise.resolve(true);
    });

    expect(sentAsDocument).toBe(false);
    expect(sentPath).not.toBe(original);
  });

  it('downscales within the photo dimension target', async () => {
    const original = await makeNoisyPng('big2.png', 256);

    let dims = { width: 0, height: 0 };
    await uploadImageWithResize(original, async (path) => {
      const meta = await sharp(path).metadata();
      dims = { width: meta.width ?? 0, height: meta.height ?? 0 };
      return true;
    });

    expect(dims.width).toBeLessThanOrEqual(LIMITS.photoMaxDimension);
    expect(dims.height).toBeLessThanOrEqual(LIMITS.photoMaxDimension);
  });

  it('leaves the original file on disk untouched', async () => {
    const original = await makeNoisyPng('keep.png', 256);
    const before = statSync(original).size;

    await uploadImageWithResize(original, () => Promise.resolve(true));

    expect(statSync(original).size).toBe(before);
  });
});

describe('images within the photo size limit', () => {
  it('sends the original unchanged as a photo', async () => {
    const original = await makeTinyPng('small.png');

    let sentPath = '';
    let sentAsDocument = true;
    await uploadImageWithResize(original, (path, forceDocument) => {
      sentPath = path;
      sentAsDocument = forceDocument;
      return Promise.resolve(true);
    });

    expect(sentPath).toBe(original);
    expect(sentAsDocument).toBe(false);
  });
});
