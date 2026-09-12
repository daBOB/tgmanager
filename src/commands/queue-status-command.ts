// src/commands/queue-status-command.ts
import { basename } from 'node:path';
import { listJobs, countJobsByStatus } from '../queue/queue-manager.js';
import type { QueueJobStatus, QueueListFilter } from '../queue/queue-types.js';
import { print } from '../utils/console-output.js';

/**
 * Rows printed when the caller does not ask for a specific number.
 *
 * The queue holds thousands of jobs, so an uncapped listing scrolls the useful
 * part — the summary — off the screen. `--limit` overrides this.
 */
export const DEFAULT_STATUS_LIMIT = 50;

/** Width of the File column; names are truncated to two less for padding. */
const FILE_COLUMN_WIDTH = 34;

/**
 * Display formatted queue status for an account.
 * Shows jobs with their status, file names, and creation time.
 * @param account - Account identifier
 * @returns true on success, false on error
 */
export function queueStatusCommand(account: string, filter: QueueListFilter = {}): boolean {
  const limit = filter.limit ?? DEFAULT_STATUS_LIMIT;
  const jobs = listJobs(account, { ...filter, limit });
  const counts = countJobsByStatus(account);

  if (jobs.length === 0) {
    const scope = filter.status ? ` with status '${filter.status}'` : '';
    print(`No jobs${scope} for account: ${account}`);
    return true;
  }

  print(`\nUpload Queue (account: ${account})\n`);

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
    const status = job.status.padEnd(12);
    const created = formatRelativeTime(job.createdAt);

    print(`${num}${id}${fileName}${status}${created}`);
  });

  // Counts come from the whole history rather than the rows just printed, so a
  // --status or --limit view still shows what else exists.
  const order: QueueJobStatus[] = ['processing', 'pending', 'completed', 'failed', 'cancelled'];
  const summary = order
    .filter(status => (counts[status] ?? 0) > 0)
    .map(status => `${counts[status]!} ${status}`)
    .join(', ');

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const shown = jobs.length === total ? '' : `showing ${jobs.length} of `;
  print(`\nSummary: ${shown}${total} jobs (${summary})`);

  // Only when the *default* cap hid rows: someone who passed --limit already
  // knows they asked for a subset.
  if (filter.limit === undefined && jobs.length < total) {
    print(`Showing the newest ${DEFAULT_STATUS_LIMIT}. Use --limit <n> for more, or --status <status> to filter.`);
  }
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

