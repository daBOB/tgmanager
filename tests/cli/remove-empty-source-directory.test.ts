// The source directory is removed after --delete-source has emptied it. The
// previous call used rmSync with recursive:false, which fails with EISDIR on
// any directory at all, so an emptied directory was never actually removed —
// and the failure was reported as "not empty", which was simply untrue.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/test-fixtures.js';
import { removeEmptySourceDirectory } from '../../src/cli/remove-empty-source-directory.js';

let workDir: string;

beforeEach(() => { workDir = makeTempDir('rmdir'); });
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

describe('removeEmptySourceDirectory', () => {
  it('removes a directory once its files are gone', () => {
    const dir = join(workDir, 'emptied');
    mkdirSync(dir);

    removeEmptySourceDirectory(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it('keeps a directory that still holds files', () => {
    const dir = join(workDir, 'partial');
    mkdirSync(dir);
    writeFileSync(join(dir, 'failed-upload.mp4'), 'x');

    removeEmptySourceDirectory(dir);

    expect(existsSync(dir)).toBe(true);
  });

  it('never deletes files, even when asked about a directory of them', () => {
    const dir = join(workDir, 'full');
    mkdirSync(dir);
    const kept = join(dir, 'keep-me.mp4');
    writeFileSync(kept, 'important');

    removeEmptySourceDirectory(dir);

    expect(existsSync(kept)).toBe(true);
  });

  it('leaves a single-file upload path alone', () => {
    const file = join(workDir, 'one.mp4');
    writeFileSync(file, 'x');

    removeEmptySourceDirectory(file);

    expect(existsSync(file)).toBe(true);
  });

  it('does nothing for a path that no longer exists', () => {
    expect(() => removeEmptySourceDirectory(join(workDir, 'gone'))).not.toThrow();
  });
});
