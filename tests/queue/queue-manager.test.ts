// Covers the queue job state machine on its SQLite backing store.
//
// The lockfile suite that used to live here is gone with the lockfile: claiming
// is now a guarded UPDATE, so exclusivity is a property of the statement rather
// than of a file created with O_EXCL.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { useRegisteredAccounts, useTempQueueHome } from '../helpers/test-fixtures.js';

useRegisteredAccounts('testaccount', 'other');
useTempQueueHome('queue');

/** Imported lazily so each test resolves the database under the current HOME. */
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

    expect(claimJob(ACCOUNT, job.id)?.status).toBe('processing');
    expect(claimJob(ACCOUNT, job.id)).toBeNull();
  });

  it('completes a claimed job and clears its worker', async () => {
    const { addJob, claimJob, completeJob, getJob } = await queue();

    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id);
    completeJob(ACCOUNT, job.id);

    const stored = getJob(ACCOUNT, job.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.workerPid).toBeNull();
    expect(stored?.completedAt).toBeTruthy();
  });

  it('records the reason a job failed', async () => {
    const { addJob, failJob, getJob } = await queue();

    const job = addJob(ACCOUNT, jobOptions());
    failJob(ACCOUNT, job.id, 'RPC_CALL_FAIL');

    const stored = getJob(ACCOUNT, job.id);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('RPC_CALL_FAIL');
  });

  it('cancels a pending job but not one already processing', async () => {
    const { addJob, claimJob, cancelJob } = await queue();

    const pending = addJob(ACCOUNT, jobOptions());
    expect(cancelJob(ACCOUNT, pending.id)).toBe(true);

    const processing = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, processing.id);
    expect(cancelJob(ACCOUNT, processing.id)).toBe(false);
  });

  it('reports false for operations on unknown jobs', async () => {
    const { claimJob, cancelJob, getJob } = await queue();

    expect(getJob(ACCOUNT, 'missing')).toBeNull();
    expect(claimJob(ACCOUNT, 'missing')).toBeNull();
    expect(cancelJob(ACCOUNT, 'missing')).toBe(false);
  });

  it('keeps accounts separate', async () => {
    const { addJob, getJob, listJobs } = await queue();

    const mine = addJob(ACCOUNT, jobOptions());

    expect(getJob('other', mine.id)).toBeNull();
    expect(listJobs('other')).toHaveLength(0);
    expect(listJobs(ACCOUNT)).toHaveLength(1);
  });

  it('returns an empty queue rather than failing when nothing exists yet', async () => {
    const { listJobs, getNextPendingJob } = await queue();

    expect(listJobs(ACCOUNT)).toEqual([]);
    expect(getNextPendingJob(ACCOUNT)).toBeNull();
  });
});

describe('priority and scheduling', () => {
  it('claims higher priority first regardless of arrival order', async () => {
    const { addJob, getNextPendingJob } = await queue();

    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/normal' }));
    const urgent = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/urgent', priority: 10 }));

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(urgent.id);
  });

  it('keeps FIFO order among jobs enqueued in the same millisecond', async () => {
    // created_at only resolves to milliseconds, and a directory enqueue inserts
    // the whole batch well inside one. Without a tiebreaker their order is
    // undefined and the queue drains arbitrarily.
    const { addJobs, getNextPendingJob, claimJob, completeJob } = await queue();

    const batch = Array.from({ length: 20 }, (_, i) => jobOptions({ filePath: `/tmp/${i}` }));
    const created = addJobs(ACCOUNT, batch);
    expect(new Set(created.map(j => j.createdAt)).size).toBeLessThan(created.length);

    const drained: string[] = [];
    for (;;) {
      const next = getNextPendingJob(ACCOUNT);
      if (!next) break;
      claimJob(ACCOUNT, next.id);
      completeJob(ACCOUNT, next.id);
      drained.push(next.filePath);
    }

    expect(drained).toEqual(batch.map((b: { filePath: string }) => b.filePath));
  });

  it('falls back to oldest-first within one priority', async () => {
    const { addJob, getNextPendingJob } = await queue();

    const first = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/a', priority: 5 }));
    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b', priority: 5 }));

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(first.id);
  });

  it('does not offer a job scheduled for the future', async () => {
    const { addJob, getNextPendingJob } = await queue();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    addJob(ACCOUNT, jobOptions({ scheduledAt: tomorrow }));

    expect(getNextPendingJob(ACCOUNT)).toBeNull();
  });

  it('offers a job whose scheduled time has passed', async () => {
    const { addJob, getNextPendingJob } = await queue();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    const due = addJob(ACCOUNT, jobOptions({ scheduledAt: yesterday }));

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(due.id);
  });

  it('skips a scheduled job in favour of one that is ready now', async () => {
    const { addJob, getNextPendingJob } = await queue();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/later', priority: 99, scheduledAt: tomorrow }));
    const ready = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/now' }));

    expect(getNextPendingJob(ACCOUNT)?.id).toBe(ready.id);
  });
});

describe('queue position', () => {
  it('is 1-indexed and honours priority', async () => {
    const { addJob, getQueuePosition } = await queue();

    const first = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/a' }));
    const second = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b' }));
    const jumped = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/c', priority: 1 }));

    expect(getQueuePosition(ACCOUNT, jumped.id)).toBe(1);
    expect(getQueuePosition(ACCOUNT, first.id)).toBe(2);
    expect(getQueuePosition(ACCOUNT, second.id)).toBe(3);
  });

  it('is -1 once the job is no longer pending', async () => {
    const { addJob, claimJob, getQueuePosition } = await queue();

    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id);

    expect(getQueuePosition(ACCOUNT, job.id)).toBe(-1);
  });
});

describe('listing and filtering', () => {
  it('filters by status in SQL', async () => {
    const { addJob, failJob, listJobs } = await queue();

    const doomed = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/bad' }));
    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/good' }));
    failJob(ACCOUNT, doomed.id, 'boom');

    const failures = listJobs(ACCOUNT, { status: 'failed' });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toBe('boom');
  });

  it('caps results with a limit', async () => {
    const { addJobs, listJobs } = await queue();

    addJobs(ACCOUNT, Array.from({ length: 10 }, (_, i) => jobOptions({ filePath: `/tmp/${i}` })));

    expect(listJobs(ACCOUNT, { limit: 3 })).toHaveLength(3);
  });

  it('counts every status in one pass', async () => {
    const { addJob, failJob, completeJob, countJobsByStatus } = await queue();

    const a = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/a' }));
    const b = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/b' }));
    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/c' }));
    completeJob(ACCOUNT, a.id);
    failJob(ACCOUNT, b.id, 'boom');

    expect(countJobsByStatus(ACCOUNT)).toEqual({ completed: 1, failed: 1, pending: 1 });
  });
});

describe('capacity', () => {
  it('accepts far more than the old 1000-job cap', async () => {
    const { addJobs, countJobsByStatus } = await queue();

    addJobs(ACCOUNT, Array.from({ length: 5000 }, (_, i) => jobOptions({ filePath: `/tmp/${i}` })));

    expect(countJobsByStatus(ACCOUNT).pending).toBe(5000);
  });
});

describe('stale job recovery', () => {
  it('returns jobs owned by a dead worker to pending', async () => {
    const { addJob, claimJob, recoverStaleJobs, getJob } = await queue();
    const { getDb } = await import('../../src/queue/queue-database.js');

    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id);
    // PID 2^22 is above Linux's default pid_max, so it cannot be running.
    getDb().prepare('UPDATE jobs SET worker_pid = ? WHERE id = ?').run(4194304, job.id);

    expect(recoverStaleJobs(ACCOUNT)).toBe(1);

    const recovered = getJob(ACCOUNT, job.id);
    expect(recovered?.status).toBe('pending');
    expect(recovered?.workerPid).toBeNull();
    expect(recovered?.startedAt).toBeNull();
  });

  it('leaves jobs owned by a live worker alone', async () => {
    const { addJob, claimJob, recoverStaleJobs, getJob } = await queue();

    const job = addJob(ACCOUNT, jobOptions());
    claimJob(ACCOUNT, job.id); // claimed by this process, which is alive

    expect(recoverStaleJobs(ACCOUNT)).toBe(0);
    expect(getJob(ACCOUNT, job.id)?.status).toBe('processing');
  });
});

describe('retention', () => {
  it('keeps finished jobs by default so history survives', async () => {
    const { addJob, completeJob, listJobs } = await queue();

    const job = addJob(ACCOUNT, jobOptions());
    completeJob(ACCOUNT, job.id);

    expect(listJobs(ACCOUNT, { status: 'completed' })).toHaveLength(1);
  });

  it('prunes only finished jobs older than the cutoff', async () => {
    const { addJob, completeJob, cleanupCompletedJobs, listJobs } = await queue();
    const { getDb } = await import('../../src/queue/queue-database.js');

    const old = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/old' }));
    completeJob(ACCOUNT, old.id);
    const longAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    getDb().prepare('UPDATE jobs SET completed_at = ? WHERE id = ?').run(longAgo, old.id);

    const recent = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/recent' }));
    completeJob(ACCOUNT, recent.id);
    const stillPending = addJob(ACCOUNT, jobOptions({ filePath: '/tmp/pending' }));

    expect(cleanupCompletedJobs(ACCOUNT, 24 * 3600_000)).toBe(1);

    const remaining = listJobs(ACCOUNT).map(j => j.id);
    expect(remaining).toContain(recent.id);
    expect(remaining).toContain(stillPending.id);
    expect(remaining).not.toContain(old.id);
  });
});

describe('job kinds', () => {
  it('defaults to a storage job addressed by virtual path', async () => {
    const { addJob } = await queue();

    const job = addJob(ACCOUNT, jobOptions());

    expect(job.kind).toBe('storage');
    expect(job.virtualPath).toBe('Archive/example.bin');
    expect(job.chatId).toBeNull();
  });

  it('stores a channel job addressed by chat id', async () => {
    const { addJob, getJob } = await queue();

    const job = addJob(ACCOUNT, {
      kind: 'channel',
      filePath: '/tmp/clip.mp4',
      chatId: '-1001909324443',
    } as never);

    const stored = getJob(ACCOUNT, job.id);
    expect(stored?.kind).toBe('channel');
    expect(stored?.chatId).toBe('-1001909324443');
    expect(stored?.virtualPath).toBeNull();
  });

  it('drains both kinds from one queue in priority order', async () => {
    const { addJob, getNextPendingJob, claimJob, completeJob } = await queue();

    addJob(ACCOUNT, jobOptions({ filePath: '/tmp/storage.bin' }));
    const urgent = addJob(ACCOUNT, {
      kind: 'channel', filePath: '/tmp/urgent.mp4', chatId: '-100', priority: 5,
    } as never);

    const first = getNextPendingJob(ACCOUNT);
    expect(first?.id).toBe(urgent.id);
    expect(first?.kind).toBe('channel');

    claimJob(ACCOUNT, first!.id);
    completeJob(ACCOUNT, first!.id);
    expect(getNextPendingJob(ACCOUNT)?.kind).toBe('storage');
  });
});

describe('schema migration', () => {
  it('adds the channel columns to a database created before they existed', async () => {
    const { getDb } = await import('../../src/queue/queue-database.js');
    const { getQueueDbPath } = await import('../../src/queue/queue-manager.js');
    const { closeDb } = await import('../../src/queue/queue-database.js');

    // Build the pre-channel schema by hand, then reopen through getDb.
    const path = getQueueDbPath();
    closeDb(path);
    mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, account TEXT NOT NULL, file_path TEXT NOT NULL,
      virtual_path TEXT, storage_channel_id TEXT, delete_source INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, scheduled_at TEXT,
      created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, error TEXT,
      worker_pid INTEGER)`);
    legacy.exec(`INSERT INTO jobs (id, account, file_path, virtual_path, status, created_at)
                 VALUES ('legacy-1', '${ACCOUNT}', '/tmp/old.bin', 'Archive/old.bin', 'pending', '2026-01-01T00:00:00.000Z')`);
    legacy.close();

    const columns = (getDb(path).prepare('PRAGMA table_info(jobs)').all() as { name: string }[])
      .map(c => c.name);
    expect(columns).toContain('kind');
    expect(columns).toContain('chat_id');
    expect(columns).toContain('content_hash');

    // The pre-existing row survives and reads back as a storage job.
    const { getJob } = await queue();
    const migrated = getJob(ACCOUNT, 'legacy-1');
    expect(migrated?.kind).toBe('storage');
    expect(migrated?.virtualPath).toBe('Archive/old.bin');
  });
});
