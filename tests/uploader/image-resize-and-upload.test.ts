import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { closeSync, openSync, rmSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/test-fixtures.js';

// Sharp is absent here on purpose. These tests cover the size-based photo /
// document decision, which must hold whether or not resizing is available —
// including in the compiled binaries, where sharp never loads.
vi.mock('../../src/utils/sharp-loader.js', () => ({
  getSharp: (): Promise<null> => Promise.resolve(null),
}));

const { uploadImageWithResize } = await import('../../src/uploader/image-resize-and-upload.js');
const { default: config } = await import('../../src/config.js');

let tempDir: string;

/** Create a sparse file of an exact size without writing its bytes. */
function makeFileOfSize(name: string, bytes: number): string {
  const path = join(tempDir, name);
  closeSync(openSync(path, 'w'));
  truncateSync(path, bytes);
  return path;
}

beforeEach(() => {
  tempDir = makeTempDir('image-upload');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('uploadImageWithResize', () => {
  const limit = config.fileProcessing.image.maxPhotoBytes;

  it('sends an image above the photo limit as a document', async () => {
    // A 12MB PNG with modest dimensions: passes every dimension check, but
    // Telegram rejects it as a photo with PHOTO_SAVE_FILE_INVALID.
    const path = makeFileOfSize('large.png', limit + 1);
    const uploadFn = vi.fn(() => Promise.resolve(true));

    await uploadImageWithResize(path, uploadFn);

    expect(uploadFn).toHaveBeenCalledWith(path, true);
  });

  it('sends an image at or below the photo limit as a photo', async () => {
    const path = makeFileOfSize('small.png', limit);
    const uploadFn = vi.fn(() => Promise.resolve(true));

    await uploadImageWithResize(path, uploadFn);

    expect(uploadFn).toHaveBeenCalledWith(path, false);
  });

  it('propagates the upload result', async () => {
    const path = makeFileOfSize('fails.png', 1024);

    await expect(uploadImageWithResize(path, () => Promise.resolve(false))).resolves.toBe(false);
  });
});
