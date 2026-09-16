// What a worker is doing now, and what follows it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { makeTempDir, useRegisteredAccounts } from '../helpers/test-fixtures.js';

useRegisteredAccounts('a');

let tempHome: string;
const realHome = process.env.HOME;

beforeEach(() => { tempHome = makeTempDir('display'); process.env.HOME = tempHome; });
afterEach(async () => {
  const { closeDb, getQueueDbPath } = await import('../../src/queue/queue-database.js');
  closeDb(getQueueDbPath());
  process.env.HOME = realHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const ACCOUNT = 'a';
const queue = () => import('../../src/queue/queue-manager.js');
const opts = (name: string, extra: Record<string, unknown> = {}) =>
  ({ filePath: `/x/${name}`, virtualPath: `V/${name}`, ...extra }) as never;

describe("order: 'queue'", () => {
  it('puts the job being uploaded first', async () => {
    const { addJob, claimJob, listJobs } = await queue();
    addJob(ACCOUNT, opts('first.mp4'));
    addJob(ACCOUNT, opts('second.mp4'));
    const running = addJob(ACCOUNT, opts('third.mp4'));
    // Claimed last, so claim order alone would sort it to the bottom.
    claimJob(ACCOUNT, running.id);

    const rows = listJobs(ACCOUNT, { status: ['processing', 'pending'], order: 'queue' });

    expect(rows[0]!.filePath).toBe('/x/third.mp4');
    expect(rows[0]!.status).toBe('processing');
  });

  it('lists the rest in the order they will run', async () => {
    const { addJob, claimJob, listJobs } = await queue();
    const running = addJob(ACCOUNT, opts('running.mp4'));
    claimJob(ACCOUNT, running.id);
    addJob(ACCOUNT, opts('normal-1.mp4'));
    addJob(ACCOUNT, opts('normal-2.mp4'));
    addJob(ACCOUNT, opts('urgent.mp4', { priority: 10 }));

    const rows = listJobs(ACCOUNT, { status: ['processing', 'pending'], order: 'queue' });

    expect(rows.map(r => r.filePath)).toEqual([
      '/x/running.mp4', '/x/urgent.mp4', '/x/normal-1.mp4', '/x/normal-2.mp4',
    ]);
  });

  it('honours a limit so only the next few are shown', async () => {
    const { addJobs, listJobs } = await queue();
    addJobs(ACCOUNT, Array.from({ length: 50 }, (_, i) => opts(`f${i}.mp4`)));

    const rows = listJobs(ACCOUNT, { status: ['processing', 'pending'], order: 'queue', limit: 5 });

    expect(rows).toHaveLength(5);
    expect(rows[0]!.filePath).toBe('/x/f0.mp4');
  });

  it("leaves history newest-first under the default order", async () => {
    const { addJob, completeJob, listJobs } = await queue();
    const older = addJob(ACCOUNT, opts('older.mp4'));
    completeJob(ACCOUNT, older.id);
    const newer = addJob(ACCOUNT, opts('newer.mp4'));
    completeJob(ACCOUNT, newer.id);

    expect(listJobs(ACCOUNT)[0]!.filePath).toBe('/x/newer.mp4');
  });
});
