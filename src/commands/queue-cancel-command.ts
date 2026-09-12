// src/commands/queue-cancel-command.ts
import { basename } from 'node:path';
import { listJobs, cancelJob } from '../queue/queue-manager.js';
import { resolveJobId } from './queue-job-id-resolver.js';
import { print, printError } from '../utils/console-output.js';

/**
 * Cancel a pending job by full or partial job ID.
 * Supports partial ID matching (minimum 1 character).
 * @param account - Account identifier
 * @param jobId - Full or partial job ID to cancel
 * @returns true on success, false on error
 */
export function queueCancelCommand(account: string, jobId: string): boolean {
  const resolution = resolveJobId(listJobs(account), jobId);

  if (resolution.kind === 'none') {
    printError(`Error: No job found with ID starting with "${jobId}"`);
    return false;
  }

  if (resolution.kind === 'ambiguous') {
    printError(`Error: Ambiguous job ID "${jobId}". Multiple matches found:`);
    for (const match of resolution.matches) {
      printError(`  ${match.id.substring(0, 8)}  ${basename(match.filePath)}  (${match.status})`);
    }
    return false;
  }

  const { job } = resolution;

  if (!cancelJob(account, job.id)) {
    printError(`Error: Job ${job.id.substring(0, 8)} is ${job.status} and can no longer be cancelled`);
    return false;
  }

  print(`\u2713 Cancelled "${basename(job.filePath)}"`);
  return true;
}
