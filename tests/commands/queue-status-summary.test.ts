import { describe, it, expect } from 'vitest';
import { buildSummaryLines } from '../../src/commands/queue-status-summary.js';

// The shape of a real queue after a large run.
const REAL = { completed: 3967, failed: 1 };

describe('filtered listings', () => {
  it('does not claim rows are hidden when the filter showed all of them', () => {
    // Previously reported "showing 1 of 3968" for a complete view of the only
    // failed job, because it compared against every job rather than the filter's.
    const { summary, hint } = buildSummaryLines(1, REAL, { status: 'failed' });

    expect(summary).not.toContain('showing');
    expect(summary).toContain('1 failed job');
    expect(hint).toBeNull();
  });

  it('reports hidden rows when a filter really does exceed the cap', () => {
    const counts = { completed: 100, failed: 80 };
    const { summary, hint } = buildSummaryLines(50, counts, { status: 'failed' });

    expect(summary).toContain('showing 50 of 80 failed jobs');
    expect(hint).toContain('--limit');
  });
});

describe('unfiltered listings', () => {
  it('reports the grand total and advises on the cap', () => {
    const { summary, hint } = buildSummaryLines(50, REAL, {});

    expect(summary).toContain('showing 50 of 3968 jobs');
    expect(hint).toContain('Use --limit');
  });

  it('says nothing about hidden rows when everything fits', () => {
    const { summary, hint } = buildSummaryLines(3, { completed: 3 }, {});

    expect(summary).toBe('Summary: 3 jobs (3 completed overall)');
    expect(hint).toBeNull();
  });
});

describe('explicit --limit', () => {
  it('suppresses the hint, since the caller chose the subset', () => {
    const { hint } = buildSummaryLines(10, REAL, { limit: 10 });

    expect(hint).toBeNull();
  });

  it('still reports how many were hidden', () => {
    const { summary } = buildSummaryLines(10, REAL, { limit: 10 });

    expect(summary).toContain('showing 10 of 3968');
  });
});

describe('breakdown', () => {
  it('lists what needs attention before finished work', () => {
    const counts = { completed: 5, pending: 2, processing: 1, failed: 3 };
    const { summary } = buildSummaryLines(11, counts, {});

    expect(summary).toContain('1 processing, 2 pending, 3 failed, 5 completed');
  });

  it('omits statuses with no jobs', () => {
    const { summary } = buildSummaryLines(1, { completed: 1 }, {});

    expect(summary).not.toContain('cancelled');
  });

  it('uses the singular for one job', () => {
    const { summary } = buildSummaryLines(1, { failed: 1 }, { status: 'failed' });

    expect(summary).toContain('1 failed job ');
  });
});

describe('headline', () => {
  it('says plainly when nothing is left to do', () => {
    // 3968 rows of finished work otherwise read as a backlog.
    const { headline } = buildSummaryLines(50, REAL, {});

    expect(headline).toBe('Nothing queued — all work finished.');
  });

  it('leads with outstanding work when there is some', () => {
    const counts = { completed: 1545, pending: 2422, processing: 1 };
    const { headline } = buildSummaryLines(50, counts, {});

    expect(headline).toBe('2423 jobs queued (1 processing, 2422 pending)');
  });

  it('counts a lone queued job in the singular', () => {
    const { headline } = buildSummaryLines(1, { pending: 1 }, {});

    expect(headline).toBe('1 job queued (1 pending)');
  });
});

describe('outstandingCount', () => {
  it('counts pending and processing, and nothing else', async () => {
    const { outstandingCount } = await import('../../src/commands/queue-status-summary.js');

    expect(outstandingCount({ pending: 3, processing: 1, completed: 99, failed: 2 })).toBe(4);
    expect(outstandingCount({ completed: 99, failed: 2, cancelled: 1 })).toBe(0);
  });
});
