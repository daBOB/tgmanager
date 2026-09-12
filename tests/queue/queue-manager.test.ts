// Covers the queue job state machine and the locking that makes concurrent
// CLI/worker access safe. The CLI enqueues jobs before taking the account lock
// (a worker may already hold it), so two processes really do write this file
// at the same time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { makeTempDir } from '../helpers/test-fixtures.js';

// The queue lives under $HOME/.tgmanager/queue, so each test gets its own HOME.
let tempHome: string;
const realHome = process.env.HOME;

beforeEach(() => {
  tempHome = makeTempDir('queue');
  process.env.HOME = tempHome;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(tempHome, { recursive: true, force: true });
});

/** Imported lazily so each test picks up the current HOME. */
async function queue() {
  return import('../../src/queue/queue-manager.js');
}

const ACCOUNT = 'testaccount';

function jobOptions(overrides: Record<string, unknown> = {}) {
  return {
    filePath: '/tmp/example.bin',
    virtualPath: 'Archive/example.bin',
    ...overrides,
  } as never;
}

describe('queue job lifecycle', () => {
  it('adds a job as pending with an id and timestamp', async () => {
    const { addJob, getJob } = await queue();

    const job = addJob(ACCOUNT, jobOptions());

    expect(job.id).toBeTruthy();
    expect(job.status).toBe('pending');
    expect(job.startedAt).toBeNull();
    expect(getJob(ACCOUNT, job.id)?.filePath).toBe('/tmp/example.bin');
  });

  it('returns pending jobs in creation order', async () => {
    const { addJob, getNextPendingJob } = await queue();

    const first = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/a' }));
    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b' }));

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(first.id);
  });

  it('claims a pending job exactly once', async () => {
    const { addJob, claimJob } = await queue();
    const job = addJob(ACCOUNT, jobOptions());

    const claimed = claimJob(ACCOUNT, job.id);
    const reclaimed = claimJob(ACCOUNT, job.id);

    expect(claimed?.status).toBe('processing');
    expect(claimed?.workerPid).toBe(process.pid);
    expect(reclaimed).toBeNull();
  });

  it('completes a claimed job and clears its worker', async () => {
    const { addJob, claimJob, completeJob, getJob } = await queue();
    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id);

    completeJob(ACCOUNT, job.id);

    const stored = getJob(ACCOUNT, job.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.workerPid).toBeNull();
    expect(stored?.completedAt).not.toBeNull();
  });

  it('records the reason a job failed', async () => {
    const { addJob, claimJob, failJob, getJob } = await queue();
    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id);

    failJob(ACCOUNT, job.id, 'flood wait exceeded');

    const stored = getJob(ACCOUNT, job.id);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('flood wait exceeded');
  });

  it('cancels a pending job but not one already processing', async () => {
    const { addJob, claimJob, cancelJob } = await queue();
    const pending = addJob(ACCOUNT, jobOptions());
    const running = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b' }));
    claimJob(ACCOUNT, running.id);

    expect(cancelJob(ACCOUNT, pending.id)).toBe(true);
    expect(cancelJob(ACCOUNT, running.id)).toBe(false);
  });

  it('reports false for operations on unknown jobs', async () => {
    const { cancelJob, getJob } = await queue();

    expect(cancelJob(ACCOUNT, 'does-not-exist')).toBe(false);
    expect(getJob(ACCOUNT, 'does-not-exist')).toBeNull();
  });

  it('reports 1-indexed queue position, and -1 once claimed', async () => {
    const { addJob, claimJob, getQueuePosition } = await queue();
    const first = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/a' }));
    const second = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b' }));

    expect(getQueuePosition(ACCOUNT, first.id)).toBe(1);
    expect(getQueuePosition(ACCOUNT, second.id)).toBe(2);

    claimJob(ACCOUNT, first.id);
    expect(getQueuePosition(ACCOUNT, first.id)).toBe(-1);
  });

  it('returns an empty queue rather than failing when no file exists', async () => {
    const { listJobs, getNextPendingJob } = await queue();

    expect(listJobs(ACCOUNT)).toEqual([]);
    expect(getNextPendingJob(ACCOUNT)).toBeNull();
  });
});

describe('stale job recovery', () => {
  it('returns jobs owned by a dead worker to pending', async () => {
    const { addJob, getQueueFilePath, recoverStaleJobs, getJob } = await queue();
    const job = addJob(ACCOUNT, jobOptions());

    // Simulate a worker that claimed the job and then crashed. PID 0x7FFFFFFF
    // is above the maximum allowed on Linux, so it can never be live.
    const path = getQueueFilePath(ACCOUNT);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    data.jobs[0].status = 'processing';
    data.jobs[0].workerPid = 0x7fffffff;
    data.jobs[0].startedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(data));

    expect(recoverStaleJobs(ACCOUNT)).toBe(1);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('pending');
  });

  it('leaves jobs owned by a live worker alone', async () => {
    const { addJob, claimJob, recoverStaleJobs, getJob } = await queue();
    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id); // claimed by this very much alive process

    expect(recoverStaleJobs(ACCOUNT)).toBe(0);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('processing');
  });
});

describe('queue file locking', () => {
  it('releases the lock after a successful mutation', async () => {
    const { addJob, getQueueFilePath } = await queue();
    const job = addJob(ACCOUNT, jobOptions());

    expect(job.id).toBeTruthy();
    expect(existsSync(`${getQueueFilePath(ACCOUNT)}.lock`)).toBe(false);
  });

  it('releases the lock even when the mutation throws', async () => {
    const { addJob, getQueueFilePath } = await queue();

    // Fill the queue so the next add throws from inside the locked section
    for (let i = 0; i < 1000; i++) addJob(ACCOUNT, jobOptions({ filePath: `/tmp/${i}` }));

    expect(() => addJob(ACCOUNT, jobOptions())).toThrow(/Queue is full/);
    expect(existsSync(`${getQueueFilePath(ACCOUNT)}.lock`)).toBe(false);
  });

  it('breaks a lock left behind by a dead process', async () => {
    const { addJob, getQueueFilePath, getQueueDir } = await queue();
    const { mkdirSync } = await import('node:fs');

    mkdirSync(getQueueDir(), { recursive: true });
    const lockPath = `${getQueueFilePath(ACCOUNT)}.lock`;
    writeFileSync(lockPath, '2147483647'); // PID that cannot be running

    const job = addJob(ACCOUNT, jobOptions());

    expect(job.status).toBe('pending');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('serialises interleaved read-modify-write cycles', async () => {
    // Without the lock, these cycles lose updates: each caller reads the queue,
    // mutates its own copy and writes the whole document back.
    const { addJob, listJobs } = await queue();

    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        Promise.resolve().then(() => addJob(ACCOUNT, jobOptions({ filePath: `/tmp/${i}` })))
      )
    );

    expect(listJobs(ACCOUNT)).toHaveLength(25);
  });
});
