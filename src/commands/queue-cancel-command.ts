// src/commands/queue-cancel-command.ts
import { basename } from 'path';
import { listJobs, cancelJob } from '../queue/queue-manager.js';

/**
 * Cancel a pending job by full or partial job ID.
 * Supports partial ID matching (minimum 1 character).
 * @param account - Account identifier
 * @param jobId - Full or partial job ID to cancel
 * @returns true on success, false on error
 */
export async function queueCancelCommand(account: string, jobId: string): Promise<boolean> {
  const jobs = listJobs(account);

  // Find matching jobs (support partial ID)
  const matches = jobId.length < 36
    ? jobs.filter(job => job.id.startsWith(jobId))
    : jobs.filter(job => job.id === jobId);

  // No matches
  if (matches.length === 0) {
    console.error(`Error: No job found with ID starting with "${jobId}"`);
    return false;
  }

  // Multiple matches (ambiguous)
  if (matches.length > 1) {
    console.error(`Error: Ambiguous job ID "${jobId}". Multiple matches found:`);
    for (const match of matches) {
      console.error(`  - ${match.id.substring(0, 8)} (${basename(match.filePath)})`);
    }
    return false;
  }

  // Single match found
  const job = matches[0]!;

  // Check if job can be cancelled (must be pending)
  if (job.status !== 'pending') {
    console.error(`Cannot cancel: status is ${job.status}`);
    return false;
  }

  // Cancel the job
  const success = cancelJob(account, job.id);

  if (!success) {
    console.error(`Failed to cancel job ${job.id.substring(0, 8)}`);
    return false;
  }

  // Success
  console.log(`Cancelled job ${job.id.substring(0, 8)} (${basename(job.filePath)})`);
  return true;
}
