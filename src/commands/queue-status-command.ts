// src/commands/queue-status-command.ts
import { basename } from 'node:path';
import { listJobs, countJobsByStatus } from '../queue/queue-manager.js';
import type { QueueJobStatus, QueueListFilter } from '../queue/queue-types.js';
import { print } from '../utils/console-output.js';

/**
 * Display formatted queue status for an account.
 * Shows all jobs with their status, file names, and creation time.
 * @param account - Account identifier
 * @returns true on success, false on error
 */
export function queueStatusCommand(account: string, filter: QueueListFilter = {}): boolean {
  const jobs = listJobs(account, filter);
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
    file: 'File'.padEnd(22),
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
    const fileName = truncateFileName(basename(job.filePath), 20).padEnd(22);
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
  print(`\nSummary: ${shown}${total} jobs (${summary})\n`);

  return true;
}

/**
 * Truncate file name to max length, adding '...' if truncated.
 * @param fileName - Original file name
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated file name
 */
function truncateFileName(fileName: string, maxLength: number): string {
  if (fileName.length <= maxLength) {
    return fileName;
  }
  return fileName.substring(0, maxLength - 3) + '...';
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

