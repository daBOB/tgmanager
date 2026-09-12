import { describe, it, expect } from 'vitest';
import { resolveJobId } from '../../src/commands/queue-job-id-resolver.js';
import type { QueueJob } from '../../src/queue/queue-types.js';

const job = (id: string): QueueJob => ({
  id, kind: 'channel', filePath: `/x/${id}.mp4`, virtualPath: null, chatId: '-100',
  contentHash: null, deleteSource: false, status: 'pending', priority: 0,
  scheduledAt: null, createdAt: '2026-09-13T00:00:00.000Z', startedAt: null,
  completedAt: null, error: null, workerPid: null,
});

const JOBS = [
  job('38492d24-0000-4000-8000-000000000001'),
  job('38492d24-0000-4000-8000-000000000002'),
  job('f2bdd442-0000-4000-8000-000000000003'),
];

describe('resolveJobId', () => {
  it('finds a job by the abbreviation queue-status prints', () => {
    const result = resolveJobId(JOBS, 'f2bdd442');

    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.job.id).toBe(JOBS[2]!.id);
  });

  it('reports ambiguity rather than guessing', () => {
    // Acting on the wrong job would cancel or restart an unrelated upload.
    const result = resolveJobId(JOBS, '38492d24');

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.matches).toHaveLength(2);
  });

  it('matches a full id exactly', () => {
    const result = resolveJobId(JOBS, JOBS[0]!.id);

    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.job.id).toBe(JOBS[0]!.id);
  });

  it('reports none when nothing matches', () => {
    expect(resolveJobId(JOBS, 'deadbeef').kind).toBe('none');
  });

  it('accepts a single character', () => {
    expect(resolveJobId(JOBS, 'f').kind).toBe('found');
  });

  it('reports none against an empty queue', () => {
    expect(resolveJobId([], 'anything').kind).toBe('none');
  });
});
