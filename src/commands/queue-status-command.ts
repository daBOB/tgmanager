// src/commands/queue-status-command.ts
import { basename } from 'node:path';
import { listJobs, countJobsByStatus } from '../queue/queue-manager.js';
import type { QueueListFilter } from '../queue/queue-types.js';
import { print } from '../utils/console-output.js';
import { buildSummaryLines, outstandingCount, OUTSTANDING } from './queue-status-summary.js';

/**
 * Rows printed when the caller does not ask for a specific number.
 *
 * The queue holds thousands of jobs, so an uncapped listing scrolls the useful
 * part — the summary — off the screen. `--limit` overrides this.
 */
export const DEFAULT_STATUS_LIMIT = 50;

/**
 * Pending jobs shown alongside whatever is uploading.
 *
 * The useful answer to "what is it doing?" is the current file and the few
 * behind it — not fifty rows that push the summary off the screen.
 */
export const NEXT_UP_COUNT = 5;

/**
 * Pick what to list when the caller named no status.
 *
 * With work outstanding the useful view is that work, in the order it will run.
 * With none, the useful view is recent history — and the headline has already
 * said the queue is clear, so the rows cannot be mistaken for a backlog.
 */
function withDefaultView(filter: QueueListFilter, counts: Record<string, number>): QueueListFilter {
  if (filter.status) return filter;

  return outstandingCount(counts) > 0
    ? { ...filter, status: OUTSTANDING, order: 'queue' }
    : filter;
}

/** Width of the File column; names are truncated to two less for padding. */
const FILE_COLUMN_WIDTH = 34;

/**
 * Display formatted queue status for an account.
 * Shows jobs with their status, file names, and creation time.
 * @param account - Account identifier
 * @returns true on success, false on error
 */
export function queueStatusCommand(account: string, filter: QueueListFilter = {}): boolean {
  const counts = countJobsByStatus(account);
  const effective = withDefaultView(filter, counts);
  // An outstanding view is deliberately short; history keeps the larger cap.
  const defaultLimit = effective.order === 'queue'
    ? (counts.processing ?? 0) + NEXT_UP_COUNT
    : DEFAULT_STATUS_LIMIT;
  const limit = effective.limit ?? defaultLimit;
  const jobs = listJobs(account, { ...effective, limit });
  const { headline, summary, hint } = buildSummaryLines(jobs.length, counts, effective);

  print(`\nUpload Queue (account: ${account})`);
  print(headline);

  if (jobs.length === 0) {
    print('');
    return true;
  }

  print('');

  // Column headers
  const headers = {
    num: '#'.padEnd(3),
    id: 'ID'.padEnd(10),
    file: 'File'.padEnd(FILE_COLUMN_WIDTH),
    status: 'Status'.padEnd(12),
    created: 'Created',
  };

  print(
    `${headers.num}${headers.id}${headers.file}${headers.status}${headers.created}`
  );

  // Print each job
  jobs.forEach((job, index) => {
    const num = String(index + 1).padEnd(3);
    const id = job.id.substring(0, 8).padEnd(10);
    const fileName = truncateFileName(basename(job.filePath), FILE_COLUMN_WIDTH - 2)
      .padEnd(FILE_COLUMN_WIDTH);
    // A running job shows how far it has got instead of repeating "processing",
    // which the row's position already conveys.
    const status = (job.status === 'processing' && job.progress !== null
      ? `${job.progress}%`
      : job.status).padEnd(12);
    const created = formatRelativeTime(job.createdAt);

    print(`${num}${id}${fileName}${status}${created}`);
  });

  print(`\n${summary}`);
  if (hint) print(hint);
  print('');

  return true;
}

/**
 * Shorten a file name to `maxLength`, dropping characters from the *front*.
 *
 * Queued batches usually share a long prefix — an exported album, a bot's
 * naming scheme — so cutting the tail leaves every row reading identically.
 * The end carries the index or title that tells them apart.
 */
export function truncateFileName(fileName: string, maxLength: number): string {
  if (fileName.length <= maxLength) return fileName;

  const ellipsis = '...';
  return ellipsis + fileName.slice(fileName.length - (maxLength - ellipsis.length));
}

/**
 * Format ISO date string as relative time.
 * @param isoDate - ISO 8601 date string
 * @returns Human-readable relative time string
 */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const created = new Date(isoDate).getTime();
  const diffMs = now - created;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return `${diffSec} sec ago`;
  } else if (diffMin < 60) {
    return `${diffMin} min ago`;
  } else if (diffHour < 24) {
    return `${diffHour}h ago`;
  } else {
    return `${diffDay}d ago`;
  }
}

