// Puts jobs back on the queue: all failures, or one job by id.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listJobs, retryFailedJobs, retryJob } from '../queue/queue-manager.js';
import { isProcessAlive } from '../utils/process-liveness.js';
import { resolveJobIdOrReport } from './queue-job-id-resolver.js';
import { print, printError } from '../utils/console-output.js';

/**
 * Requeue failed jobs, or one specific job.
 *
 * @param jobId - full or partial id; omit to requeue every failed job
 * @returns true on success, false when nothing matched
 */
export function queueRetryCommand(account: string, jobId?: string): boolean {
  return jobId ? retryOne(account, jobId) : retryAllFailed(account);
}

function retryAllFailed(account: string): boolean {
  const { requeued, skippedMissing } = retryFailedJobs(account);

  if (requeued === 0 && skippedMissing === 0) {
    print('No failed jobs to retry.');
    return true;
  }

  if (requeued > 0) {
    print(`✓ Requeued ${requeued} failed job${requeued === 1 ? '' : 's'}`);
    print('Run `-c queue-run` to start processing them.');
  }

  if (skippedMissing > 0) {
    print(`⏭  Skipped ${skippedMissing} job${skippedMissing === 1 ? '' : 's'} whose source file no longer exists`);
    print('   (typically already uploaded successfully under a later attempt)');
  }

  return true;
}

function retryOne(account: string, jobId: string): boolean {
  const job = resolveJobIdOrReport(listJobs(account), jobId);
  if (!job) return false;

  if (job.status === 'pending') {
    print(`Job ${job.id.substring(0, 8)} is already queued.`);
    return true;
  }

  // A live worker still owns this job and may finish it, overwriting the reset
  // and leaving the file uploaded twice. Say so rather than silently racing it.
  if (job.status === 'processing' && job.workerPid !== null && isProcessAlive(job.workerPid)) {
    printError(`Error: Job ${job.id.substring(0, 8)} is being processed by a running worker (pid ${job.workerPid}).`);
    printError('Stop that process first, then retry.');
    return false;
  }

  if (!existsSync(job.filePath)) {
    printError(`Error: Source file no longer exists: ${job.filePath}`);
    printError('It was most likely uploaded successfully by a later attempt.');
    return false;
  }

  if (!retryJob(account, job.id)) {
    printError(`Error: Could not requeue job ${job.id.substring(0, 8)}`);
    return false;
  }

  print(`✓ Requeued "${basename(job.filePath)}"`);
  print('Run `-c queue-run` to start processing it.');
  return true;
}
