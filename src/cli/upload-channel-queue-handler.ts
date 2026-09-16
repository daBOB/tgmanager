// Enqueues plain `upload` work (a file or a directory bound for an arbitrary
// chat) as queue jobs, mirroring what upload-storage-queue-handler does for the
// storage tree.
//
// Uploading directly used to mean a killed run lost its place and had to rescan
// from the start, and a failed file was recorded only in the log. As queue jobs
// each file is durable: the next run resumes, and failures are listable long
// after the fact.
import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import logger from '../logger.js';
import { print, printError } from '../utils/console-output.js';
import type { CommandOptions } from '../types/index.js';
import type { QueueAddOptions } from '../queue/queue-types.js';
import { reportMissingUploadPath, type QueueOutcome } from './queue-outcome.js';

/**
 * List the files a directory upload covers.
 *
 * Deliberately shallow and dot-filtered, matching what the direct upload path
 * did — recursing would silently change which files a long-standing command
 * uploads.
 */
function listDirectoryFiles(uploadPath: string): string[] {
  return readdirSync(uploadPath)
    .filter(name => !name.startsWith('.'))
    .map(name => join(uploadPath, name))
    .filter(path => statSync(path).isFile());
}

/**
 * Queue a file or directory for upload to a chat.
 *
 * @returns `queued` with the job ids, or `done` when there is nothing to do.
 */
export async function handleUploadChannelQueue(
  account: string,
  uploadPath: string,
  options: CommandOptions,
  addJobs: (account: string, jobs: QueueAddOptions[]) => { id: string }[]
): Promise<QueueOutcome> {
  if (reportMissingUploadPath(uploadPath)) return { kind: 'done', exitCode: 1 };

  const isDirectory = statSync(uploadPath).isDirectory();
  const files = isDirectory ? listDirectoryFiles(uploadPath) : [uploadPath];

  if (files.length === 0) {
    printError(`❌ No files found in directory: ${basename(uploadPath)}`);
    return { kind: 'done', exitCode: 1 };
  }

  const { candidates, skipped } = await selectNewFiles(account, files, options);

  if (candidates.length === 0) {
    print(`\nAll ${skipped} file(s) already uploaded to this chat. Nothing to queue.`);
    return { kind: 'done', exitCode: 0 };
  }

  const jobs = addJobs(
    account,
    candidates.map(({ filePath, contentHash }) => ({
      kind: 'channel' as const,
      filePath,
      chatId: options.chatId,
      contentHash,
      deleteSource: options.deleteSource,
      priority: options.priority,
    }))
  );

  const label = isDirectory ? `${jobs.length} files from '${basename(uploadPath)}'` : basename(uploadPath);
  print(`\n✓ Queued ${label} for upload`);
  if (skipped > 0) print(`⏭  Skipped ${skipped} file(s) already uploaded to this chat`);
  logger.info('Channel upload queued', { count: jobs.length, skipped, chatId: options.chatId });

  return { kind: 'queued', jobIds: jobs.map(j => j.id) };
}

/**
 * Hash each candidate and drop the ones whose bytes already reached this chat.
 *
 * Identity is the content, not the name: the same image routinely arrives under
 * different names from different albums, and a name-based check would miss it
 * while also falsely matching unrelated files that share a bot's naming scheme.
 *
 * Hashing reads every file in full, which `--force` skips entirely when the
 * intent is to re-upload regardless.
 */
async function selectNewFiles(
  account: string,
  files: string[],
  options: CommandOptions
): Promise<{ candidates: { filePath: string; contentHash: string | null }[]; skipped: number }> {
  if (options.force || !options.chatId) {
    return { candidates: files.map(filePath => ({ filePath, contentHash: null })), skipped: 0 };
  }

  const { knownContentHashes } = await import('../queue/queue-manager.js');
  const { hashFile } = await import('../storage/checksum-utils.js');
  const { createHashProgressBar } = await import('../commands/upload-storage-progress-reporter.js');
  // One query for the whole chat: a directory enqueue checks thousands of files.
  // Includes work already queued, so resuming tops the queue up rather than doubling it.
  const alreadyUploaded = knownContentHashes(account, options.chatId);

  const candidates: { filePath: string; contentHash: string | null }[] = [];
  let skipped = 0;

  // Hashing reads every byte of every candidate before a single job is queued.
  // Over a large library that is minutes of silence, which reads as a hang.
  const bar = createHashProgressBar();
  bar.start(files.length, 0, { file: '' });

  for (const [index, filePath] of files.entries()) {
    bar.update(index, { file: basename(filePath).slice(0, 28) });
    try {
      const { hash } = await hashFile(filePath);
      if (alreadyUploaded.has(hash)) {
        skipped++;
        logger.info('Skipping duplicate', { file: basename(filePath), hash });
        continue;
      }
      candidates.push({ filePath, contentHash: hash });
    } catch (error) {
      // An unreadable file is the upload's problem to report, not the dedup
      // check's — queue it and let the worker surface the real failure.
      logger.warn('Could not hash file, queueing without duplicate check', {
        file: basename(filePath),
        error: (error as Error).message,
      });
      candidates.push({ filePath, contentHash: null });
    }
  }

  bar.update(files.length);
  bar.stop();

  return { candidates, skipped };
}
