import { describe, it, expect } from 'vitest';
import {
  isJobStalled,
  describeJobStatus,
  stalledNotice,
} from '../../src/commands/queue-status-liveness.js';
import type { QueueJob } from '../../src/queue/queue-types.js';

/** A job row carrying only the fields the status display reads. */
function job(fields: Partial<QueueJob>): QueueJob {
  return {
    id: 'job-1',
    account: 'acct',
    kind: 'storage',
    filePath: '/x/file.mp4',
    status: 'processing',
    createdAt: '2026-09-15T06:00:00.000Z',
    startedAt: null,
    completedAt: null,
    error: null,
    workerPid: null,
    progress: null,
    priority: 0,
    scheduledAt: null,
    ...fields,
  } as QueueJob;
}

const alive = () => true;
const dead = () => false;

describe('describeJobStatus', () => {
  it('shows progress while the claiming worker is running', () => {
    expect(describeJobStatus(job({ workerPid: 4242, progress: 52 }), false)).toBe('52%');
  });

  it('shows "processing" for a live worker that has not reported progress yet', () => {
    expect(describeJobStatus(job({ workerPid: 4242, progress: null }), false)).toBe('processing');
  });

  // The defect this module exists for: a worker killed mid-upload (a reboot, an
  // OOM) leaves status='processing' and its last progress value behind. Printed
  // as "52%" that is indistinguishable from a live upload, so an abandoned queue
  // reads as a working one — for 35 hours, in the case that prompted this.
  it('marks a claim whose worker is gone as stalled, not as live progress', () => {
    expect(describeJobStatus(job({ workerPid: 660471, progress: 52 }), true)).toBe('stalled 52%');
  });

  it('marks a dead worker that never reported progress as stalled', () => {
    expect(describeJobStatus(job({ workerPid: 660471, progress: null }), true)).toBe('stalled');
  });

  // Nothing can be proven to be working on it, so it cannot be called live.
  it('treats a claim with no recorded pid as stalled', () => {
    expect(describeJobStatus(job({ workerPid: null, progress: 12 }), isJobStalled(job({ workerPid: null, progress: 12 }), alive))).toBe('stalled 12%');
  });

  it('never claims a dead worker is live, whatever the progress', () => {
    for (const progress of [0, 1, 52, 99, 100]) {
      expect(describeJobStatus(job({ workerPid: 660471, progress }), true)).toMatch(/^stalled/);
    }
  });

  it('passes non-processing statuses through unchanged', () => {
    for (const status of ['pending', 'failed', 'completed', 'cancelled'] as const) {
      expect(describeJobStatus(job({ status, progress: null }), false)).toBe(status);
    }
  });

  // The Status column is padded to 12 characters; a longer string breaks the
  // table alignment that makes the listing readable.
  it('fits the status column', () => {
    expect(describeJobStatus(job({ workerPid: 1, progress: 100 }), true).length)
      .toBeLessThanOrEqual(12);
  });
});

describe('isJobStalled', () => {
  it('is false while the claiming worker is running', () => {
    expect(isJobStalled(job({ workerPid: 4242 }), alive)).toBe(false);
  });

  it('is true once that worker is gone', () => {
    expect(isJobStalled(job({ workerPid: 660471 }), dead)).toBe(true);
  });

  // Nothing can be proven to be working on it, so it cannot be called live.
  it('is true for a claim with no recorded pid', () => {
    expect(isJobStalled(job({ workerPid: null }), alive)).toBe(true);
  });

  it('is false for any job that is not processing', () => {
    for (const status of ['pending', 'failed', 'completed', 'cancelled'] as const) {
      expect(isJobStalled(job({ status, workerPid: null }), dead)).toBe(false);
    }
  });

  // The count in the warning is derived from this same predicate, so the two
  // cannot drift apart the way a separate counting pass could.
  it('drives the stalled count for a listing', () => {
    const jobs = [
      job({ id: 'a', status: 'processing', workerPid: 1 }),
      job({ id: 'b', status: 'processing', workerPid: 2 }),
      job({ id: 'c', status: 'pending', workerPid: null }),
    ];

    expect(jobs.filter(j => isJobStalled(j, pid => pid === 1)).length).toBe(1);
  });
});

describe('stalledNotice', () => {
  it('says nothing when the queue is healthy', () => {
    expect(stalledNotice(0)).toBeNull();
  });

  // A stalled queue looks identical to a busy one until something says
  // otherwise, so the notice has to name the recovery command outright.
  it('names the command that recovers stalled work', () => {
    expect(stalledNotice(1)).toContain('queue-run');
  });

  it('reports how many claims were abandoned', () => {
    expect(stalledNotice(3)).toContain('3');
  });

  it('reads as singular for one stalled job', () => {
    expect(stalledNotice(1)).toMatch(/1 job is/);
  });

  it('reads as plural for several', () => {
    expect(stalledNotice(2)).toMatch(/2 jobs are/);
  });
});
