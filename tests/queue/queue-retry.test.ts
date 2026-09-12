// Restarting work: failures are not permanent, and a job can be stranded in
// `processing` by a worker that is alive but no longer progressing — the case
// stale recovery cannot see, since it only looks for dead processes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../helpers/test-fixtures.js';

let tempHome: string;
let workDir: string;
const realHome = process.env.HOME;

/** A real file on disk, since retry now refuses jobs whose source is gone. */
function realFile(name: string): string {
  const path = join(workDir, name);
  writeFileSync(path, 'x');
  return path;
}

beforeEach(() => {
  tempHome = makeTempDir('retry');
  workDir = makeTempDir('retry-files');
  process.env.HOME = tempHome;
});

afterEach(async () => {
  const { closeDb, getQueueDbPath } = await import('../../src/queue/queue-database.js');
  closeDb(getQueueDbPath());
  process.env.HOME = realHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

const ACCOUNT = 'testaccount';
const queue = () => import('../../src/queue/queue-manager.js');
const opts = (o: Record<string, unknown> = {}) =>
  ({ filePath: realFile('f.bin'), virtualPath: 'Archive/f.bin', ...o }) as never;

describe('retryFailedJobs', () => {
  it('returns failed jobs to pending and clears the error', async () => {
    const { addJob, failJob, retryFailedJobs, getJob } = await queue();
    const job = addJob(ACCOUNT, opts());
    failJob(ACCOUNT, job.id, '-503: Timeout');

    expect(retryFailedJobs(ACCOUNT).requeued).toBe(1);

    const requeued = getJob(ACCOUNT, job.id);
    expect(requeued?.status).toBe('pending');
    expect(requeued?.error).toBeNull();
    expect(requeued?.completedAt).toBeNull();
  });

  it('leaves completed and cancelled jobs alone', async () => {
    const { addJob, completeJob, cancelJob, failJob, retryFailedJobs, getJob } = await queue();
    const done = addJob(ACCOUNT, opts({ filePath: realFile('done.bin') }));
    const gone = addJob(ACCOUNT, opts({ filePath: realFile('gone.bin') }));
    const bad = addJob(ACCOUNT, opts({ filePath: realFile('bad.bin') }));
    completeJob(ACCOUNT, done.id);
    cancelJob(ACCOUNT, gone.id);
    failJob(ACCOUNT, bad.id, 'boom');

    expect(retryFailedJobs(ACCOUNT).requeued).toBe(1);
    expect(getJob(ACCOUNT, done.id)?.status).toBe('completed');
    expect(getJob(ACCOUNT, gone.id)?.status).toBe('cancelled');
  });

  it('reports zero when there is nothing to retry', async () => {
    const { retryFailedJobs } = await queue();
    expect(retryFailedJobs(ACCOUNT).requeued).toBe(0);
  });

  it('makes a retried job claimable again', async () => {
    const { addJob, failJob, retryFailedJobs, getNextPendingJob } = await queue();
    const job = addJob(ACCOUNT, opts());
    failJob(ACCOUNT, job.id, 'boom');
    retryFailedJobs(ACCOUNT);

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(job.id);
  });
});

describe('retryJob', () => {
  it('frees a job stuck in processing', async () => {
    const { addJob, claimJob, retryJob, getJob } = await queue();
    const job = addJob(ACCOUNT, opts());
    claimJob(ACCOUNT, job.id);

    expect(retryJob(ACCOUNT, job.id)).toBe(true);

    const freed = getJob(ACCOUNT, job.id);
    expect(freed?.status).toBe('pending');
    expect(freed?.workerPid).toBeNull();
    expect(freed?.startedAt).toBeNull();
  });

  it('can re-run a completed job', async () => {
    const { addJob, completeJob, retryJob, getJob } = await queue();
    const job = addJob(ACCOUNT, opts());
    completeJob(ACCOUNT, job.id);

    expect(retryJob(ACCOUNT, job.id)).toBe(true);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('pending');
  });

  it('reports false for a job that is already pending', async () => {
    const { addJob, retryJob } = await queue();
    const job = addJob(ACCOUNT, opts());

    expect(retryJob(ACCOUNT, job.id)).toBe(false);
  });

  it('reports false for an unknown job', async () => {
    const { retryJob } = await queue();
    expect(retryJob(ACCOUNT, 'missing')).toBe(false);
  });

  it('does not touch another account', async () => {
    const { addJob, failJob, retryJob, getJob } = await queue();
    const job = addJob(ACCOUNT, opts());
    failJob(ACCOUNT, job.id, 'boom');

    expect(retryJob('other', job.id)).toBe(false);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('failed');
  });
});

describe('jobs whose source file is gone', () => {
  it('does not requeue them', async () => {
    // --delete-source removes each file as it lands, so a failure later retried
    // successfully leaves a stale failed row pointing at nothing.
    const { addJob, failJob, retryFailedJobs, getJob } = await queue();
    const job = addJob(ACCOUNT, opts({ filePath: join(workDir, 'never-written.bin') }));
    failJob(ACCOUNT, job.id, 'boom');

    const outcome = retryFailedJobs(ACCOUNT);

    expect(outcome.requeued).toBe(0);
    expect(outcome.skippedMissing).toBe(1);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('failed');
  });

  it('still requeues the ones that can run', async () => {
    const { addJob, failJob, retryFailedJobs } = await queue();
    const runnable = addJob(ACCOUNT, opts({ filePath: realFile('here.bin') }));
    const vanished = addJob(ACCOUNT, opts({ filePath: join(workDir, 'absent.bin') }));
    failJob(ACCOUNT, runnable.id, 'boom');
    failJob(ACCOUNT, vanished.id, 'boom');

    const outcome = retryFailedJobs(ACCOUNT);

    expect(outcome).toEqual({ requeued: 1, skippedMissing: 1 });
  });
});
