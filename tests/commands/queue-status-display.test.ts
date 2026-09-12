import { describe, it, expect } from 'vitest';
import { DEFAULT_STATUS_LIMIT, truncateFileName } from '../../src/commands/queue-status-command.js';

describe('truncateFileName', () => {
  // Queued batches routinely share a long prefix (an exported album, a bot's
  // naming scheme). Truncating the tail renders every row identical, which is
  // what made a real 3968-job queue unreadable.
  it('keeps the distinctive tail when names share a prefix', () => {
    const a = truncateFileName('by @onlyfans_accelerator__0001.jpg', 24);
    const b = truncateFileName('by @onlyfans_accelerator__0002.jpg', 24);

    expect(a).not.toBe(b);
    expect(a).toContain('0001.jpg');
    expect(b).toContain('0002.jpg');
  });

  it('marks that the front was dropped', () => {
    expect(truncateFileName('a-very-long-file-name-indeed.mp4', 20)).toMatch(/^\.\.\./);
  });

  it('never exceeds the requested width', () => {
    for (const width of [8, 12, 20, 40]) {
      expect(truncateFileName('some-quite-long-file-name.mkv', width).length)
        .toBeLessThanOrEqual(width);
    }
  });

  it('leaves a name that already fits untouched', () => {
    expect(truncateFileName('short.mp4', 20)).toBe('short.mp4');
  });

  it('handles a name exactly at the limit', () => {
    const name = 'exactly-twenty-chars';
    expect(truncateFileName(name, name.length)).toBe(name);
  });
});

describe('default row limit', () => {
  it('caps output so a bare queue-status cannot flood the terminal', () => {
    // A real queue reached 3968 jobs; without a default every one would print.
    expect(DEFAULT_STATUS_LIMIT).toBeGreaterThan(0);
    expect(DEFAULT_STATUS_LIMIT).toBeLessThanOrEqual(100);
  });
});
