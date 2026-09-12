// Builds the summary line under a queue listing.
//
// Pure so the counting rules can be checked directly: they were wrong in a way
// that reads as correct, reporting "showing 1 of 3968" for a filtered view that
// was in fact showing everything it matched.
import type { QueueJobStatus, QueueListFilter } from '../queue/queue-types.js';

/** Order statuses are reported in: what needs attention first. */
const REPORT_ORDER: QueueJobStatus[] = ['processing', 'pending', 'failed', 'completed', 'cancelled'];

export interface SummaryLines {
  /** The "Summary: ..." line. */
  summary: string;
  /** Advice about hidden rows, or null when nothing was cut off. */
  hint: string | null;
}

/**
 * @param shownCount - rows actually printed
 * @param counts - job totals per status across the whole history
 * @param filter - the filter that produced the listing
 * @param defaultLimit - cap applied when the caller named no limit
 */
export function buildSummaryLines(
  shownCount: number,
  counts: Record<string, number>,
  filter: QueueListFilter,
  defaultLimit: number
): SummaryLines {
  const breakdown = REPORT_ORDER
    .filter(status => (counts[status] ?? 0) > 0)
    .map(status => `${counts[status]!} ${status}`)
    .join(', ');

  const grandTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);

  // A filtered listing is complete when it holds every job of that status —
  // comparing it against the grand total instead claims rows are hidden that
  // the filter deliberately excluded.
  const scopeTotal = filter.status ? (counts[filter.status] ?? 0) : grandTotal;
  const hiddenRows = scopeTotal - shownCount;

  const noun = filter.status ? `${filter.status} job` : 'job';
  const plural = scopeTotal === 1 ? '' : 's';
  const prefix = hiddenRows > 0 ? `showing ${shownCount} of ` : '';

  const summary = `Summary: ${prefix}${scopeTotal} ${noun}${plural}` +
    (breakdown ? ` (${breakdown})` : '');

  // Only when the default cap did the hiding: someone who passed --limit chose
  // their own subset, and a filtered view that fits needs no advice at all.
  const hint = filter.limit === undefined && hiddenRows > 0
    ? `Showing the newest ${defaultLimit}. Use --limit <n> for more, or --status <status> to filter.`
    : null;

  return { summary, hint };
}
