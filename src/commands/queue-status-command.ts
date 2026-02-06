// src/commands/queue-status-command.ts
import { basename } from 'path';
import { listJobs } from '../queue/queue-manager.js';
import type { QueueJob, QueueJobStatus } from '../queue/queue-types.js';

/**
 * Display formatted queue status for an account.
 * Shows all jobs with their status, file names, and creation time.
 * @param account - Account identifier
 * @returns true on success, false on error
 */
export async function queueStatusCommand(account: string): Promise<boolean> {
  const jobs = listJobs(account);

  if (jobs.length === 0) {
    console.log(`No jobs in queue for account: ${account}`);
    return true;
  }

  // Print header
  console.log(`\nUpload Queue (account: ${account})\n`);

  // Column headers
  const headers = {
    num: '#'.padEnd(3),
    id: 'ID'.padEnd(10),
    file: 'File'.padEnd(22),
    status: 'Status'.padEnd(12),
    created: 'Created',
  };

  console.log(
    `${headers.num}${headers.id}${headers.file}${headers.status}${headers.created}`
  );

  // Print each job
  jobs.forEach((job, index) => {
    const num = String(index + 1).padEnd(3);
    const id = job.id.substring(0, 8).padEnd(10);
    const fileName = truncateFileName(basename(job.filePath), 20).padEnd(22);
    const status = job.status.padEnd(12);
    const created = formatRelativeTime(job.createdAt);

    console.log(`${num}${id}${fileName}${status}${created}`);
  });

  // Print summary
  const statusCounts = countJobsByStatus(jobs);
  const summaryParts: string[] = [];

  if (statusCounts.processing > 0) {
    summaryParts.push(`${statusCounts.processing} processing`);
  }
  if (statusCounts.pending > 0) {
    summaryParts.push(`${statusCounts.pending} pending`);
  }
  if (statusCounts.completed > 0) {
    summaryParts.push(`${statusCounts.completed} completed`);
  }
  if (statusCounts.failed > 0) {
    summaryParts.push(`${statusCounts.failed} failed`);
  }
  if (statusCounts.cancelled > 0) {
    summaryParts.push(`${statusCounts.cancelled} cancelled`);
  }

  const summary = summaryParts.join(', ');
  console.log(`\nSummary: ${jobs.length} jobs (${summary})\n`);

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

/**
 * Count jobs by status for summary display.
 * @param jobs - Array of queue jobs
 * @returns Object with count per status
 */
function countJobsByStatus(jobs: QueueJob[]): Record<QueueJobStatus, number> {
  const counts: Record<QueueJobStatus, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const job of jobs) {
    counts[job.status]++;
  }

  return counts;
}
