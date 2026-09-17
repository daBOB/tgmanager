// Input is checked before any job is written.
//
// A chat id the client cannot resolve used to be rejected only after the whole
// directory had been hashed and enqueued, which left hundreds of jobs in the
// queue addressed to a chat that could never be found — none of them runnable,
// and no bulk way to take them back out.
//
// Which ids are well formed is settled in tests/utils/validation.test.ts; what
// matters here is only that the check runs before the queue is touched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir, useTempQueueHome } from '../helpers/test-fixtures.js';

const addJobs = vi.fn(() => [{ id: 'job-1' }]);

vi.mock('../../src/config.js', () => ({
  default: {
    accounts: { testaccount: { apiId: 1, apiHash: 'hash', phoneNumber: '+10000000000' } },
    app: { logLevel: 'error', sessionDir: makeSessionDir(), uploadDir: makeSessionDir() },
    telegram: { connectionRetries: 1, floodWaitMultiplier: 1 },
    fileProcessing: {
      image: {
        maxDimension: 2560, maxCombinedDimensions: 10000, maxPhotoBytes: 10 * 1024 * 1024,
        photoMaxDimension: 2560, photoJpegQuality: 85, supportedFormats: ['.jpg'],
      },
      video: { defaultWidth: 1280, defaultHeight: 720, defaultDuration: 0 },
      premium: { maxFileSizeBytes: 4 * 1024 ** 3 },
      regular: { maxFileSizeBytes: 2 * 1024 ** 3 },
    },
  },
}));

vi.mock('../../src/queue/queue-manager.js', () => ({
  addJobs,
  addJob: () => ({ id: 'job-1' }),
  getQueuePosition: () => 1,
  knownContentHashes: () => new Set<string>(),
  listJobs: () => [],
}));

/** Hoisted above the mock factory, so it cannot close over test state. */
function makeSessionDir(): string {
  return '/tmp/tgmanager-dispatch-test';
}

useTempQueueHome('dispatch');

let workDir: string;

beforeEach(() => {
  addJobs.mockClear();
  workDir = makeTempDir('dispatch-files');
  writeFileSync(join(workDir, 'clip.mp4'), 'x');
});

describe('dispatch input validation', () => {
  it('queues nothing when the chat id is not a form the client can resolve', async () => {
    const { dispatch } = await import('../../src/cli/command-dispatcher.js');

    const code = await dispatch({
      account: 'testaccount',
      command: 'upload',
      chatId: 'Sally Dinosaur',
      filePath: workDir,
    });

    expect(code).toBe(1);
    expect(addJobs).not.toHaveBeenCalled();
  });

});
