// Builds the headline and summary lines around a queue listing.
//
// Pure so the counting rules can be checked directly: they were wrong once
// already, in a way that reads as correct — reporting "showing 1 of 3968" for a
// filtered view that was in fact showing everything it matched.
import type { QueueJobStatus, QueueListFilter } from '../queue/queue-types.js';

/** Order statuses are reported in: what needs attention first. */
const REPORT_ORDER: QueueJobStatus[] = ['processing', 'pending', 'failed', 'completed', 'cancelled'];

/** Statuses that represent work still to be done. */
export const OUTSTANDING: QueueJobStatus[] = ['processing', 'pending'];

export interface SummaryLines {
  /** States up front whether any work is left, before any rows are printed. */
  headline: string;
  /** The "Summary: ..." line. */
  summary: string;
  /** Advice about hidden rows, or null when nothing was cut off. */
  hint: string | null;
}

/** Jobs still to run. Kept here so the headline and the default view agree. */
export function outstandingCount(counts: Record<string, number>): number {
  return OUTSTANDING.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

function describe(counts: Record<string, number>, statuses: QueueJobStatus[]): string {
  return statuses
    .filter(status => (counts[status] ?? 0) > 0)
    .map(status => `${counts[status]!} ${status}`)
    .join(', ');
}

/**
 * @param shownCount - rows actually printed
 * @param counts - job totals per status across the whole history
 * @param filter - the filter that produced the listing
 */
export function buildSummaryLines(
  shownCount: number,
  counts: Record<string, number>,
  filter: QueueListFilter
): SummaryLines {
  const grandTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const outstanding = outstandingCount(counts);

  // The question the command exists to answer, answered before any rows: a
  // listing of thousands of finished jobs otherwise reads as a backlog.
  const headline = outstanding > 0
    ? `${outstanding} job${outstanding === 1 ? '' : 's'} queued (${describe(counts, OUTSTANDING)})`
    : 'Nothing queued — all work finished.';

  // A filtered listing is complete when it holds every job it selects;
  // comparing it against the grand total instead claims rows are hidden that
  // the filter deliberately excluded.
  const selected: QueueJobStatus[] | null = filter.status
    ? (Array.isArray(filter.status) ? filter.status : [filter.status])
    : null;
  const scopeTotal = selected
    ? selected.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
    : grandTotal;
  const hiddenRows = scopeTotal - shownCount;

  const label = selected ? `${selected.join('/')} job` : 'job';
  const plural = scopeTotal === 1 ? '' : 's';
  const prefix = hiddenRows > 0 ? `showing ${shownCount} of ` : '';
  const breakdown = describe(counts, REPORT_ORDER);

  const summary = `Summary: ${prefix}${scopeTotal} ${label}${plural}` +
    (breakdown ? ` (${breakdown} overall)` : '');

  // Only when the default cap did the hiding: someone who passed --limit chose
  // their own subset, and a view that fits needs no advice at all.
  const hint = filter.limit === undefined && hiddenRows > 0
    ? `Showing ${shownCount} of them. Use --limit <n> for more, or --status <status> to filter.`
    : null;

  return { headline, summary, hint };
}
