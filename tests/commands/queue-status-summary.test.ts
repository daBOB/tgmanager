import { describe, it, expect } from 'vitest';
import { buildSummaryLines } from '../../src/commands/queue-status-summary.js';

const LIMIT = 50;
// The shape of a real queue after a large run.
const REAL = { completed: 3967, failed: 1 };

describe('filtered listings', () => {
  it('does not claim rows are hidden when the filter showed all of them', () => {
    // Previously reported "showing 1 of 3968" for a complete view of the only
    // failed job, because it compared against every job rather than the filter's.
    const { summary, hint } = buildSummaryLines(1, REAL, { status: 'failed' }, LIMIT);

    expect(summary).not.toContain('showing');
    expect(summary).toContain('1 failed job');
    expect(hint).toBeNull();
  });

  it('reports hidden rows when a filter really does exceed the cap', () => {
    const counts = { completed: 100, failed: 80 };
    const { summary, hint } = buildSummaryLines(50, counts, { status: 'failed' }, LIMIT);

    expect(summary).toContain('showing 50 of 80 failed jobs');
    expect(hint).toContain('--limit');
  });
});

describe('unfiltered listings', () => {
  it('reports the grand total and advises on the cap', () => {
    const { summary, hint } = buildSummaryLines(50, REAL, {}, LIMIT);

    expect(summary).toContain('showing 50 of 3968 jobs');
    expect(hint).toContain('Showing the newest 50');
  });

  it('says nothing about hidden rows when everything fits', () => {
    const { summary, hint } = buildSummaryLines(3, { completed: 3 }, {}, LIMIT);

    expect(summary).toBe('Summary: 3 jobs (3 completed)');
    expect(hint).toBeNull();
  });
});

describe('explicit --limit', () => {
  it('suppresses the hint, since the caller chose the subset', () => {
    const { hint } = buildSummaryLines(10, REAL, { limit: 10 }, LIMIT);

    expect(hint).toBeNull();
  });

  it('still reports how many were hidden', () => {
    const { summary } = buildSummaryLines(10, REAL, { limit: 10 }, LIMIT);

    expect(summary).toContain('showing 10 of 3968');
  });
});

describe('breakdown', () => {
  it('lists what needs attention before finished work', () => {
    const counts = { completed: 5, pending: 2, processing: 1, failed: 3 };
    const { summary } = buildSummaryLines(11, counts, {}, LIMIT);

    expect(summary).toContain('1 processing, 2 pending, 3 failed, 5 completed');
  });

  it('omits statuses with no jobs', () => {
    const { summary } = buildSummaryLines(1, { completed: 1 }, {}, LIMIT);

    expect(summary).not.toContain('cancelled');
  });

  it('uses the singular for one job', () => {
    const { summary } = buildSummaryLines(1, { failed: 1 }, { status: 'failed' }, LIMIT);

    expect(summary).toContain('1 failed job ');
  });
});
