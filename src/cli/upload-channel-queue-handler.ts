// Enqueues plain `upload` work (a file or a directory bound for an arbitrary
// chat) as queue jobs, mirroring what upload-storage-queue-handler does for the
// storage tree.
//
// Uploading directly used to mean a killed run lost its place and had to rescan
// from the start, and a failed file was recorded only in the log. As queue jobs
// each file is durable: the next run resumes, and failures are listable long
// after the fact.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import logger from '../logger.js';
import { print, printError } from '../utils/console-output.js';
import type { CommandOptions } from '../types/index.js';
import type { QueueAddOptions } from '../queue/queue-types.js';
import type { QueueOutcome } from './upload-storage-queue-handler.js';

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
export function handleUploadChannelQueue(
  account: string,
  uploadPath: string,
  options: CommandOptions,
  addJobs: (account: string, jobs: QueueAddOptions[]) => { id: string }[]
): QueueOutcome {
  if (!existsSync(uploadPath)) {
    logger.error(`File not found: ${uploadPath}`);
    printError(`❌ File not found: ${uploadPath}`);
    return { kind: 'done', exitCode: 1 };
  }

  const isDirectory = statSync(uploadPath).isDirectory();
  const files = isDirectory ? listDirectoryFiles(uploadPath) : [uploadPath];

  if (files.length === 0) {
    printError(`❌ No files found in directory: ${basename(uploadPath)}`);
    return { kind: 'done', exitCode: 1 };
  }

  const jobs = addJobs(
    account,
    files.map(filePath => ({
      kind: 'channel' as const,
      filePath,
      chatId: options.chatId,
      deleteSource: options.deleteSource,
      priority: options.priority,
    }))
  );

  const label = isDirectory ? `${jobs.length} files from '${basename(uploadPath)}'` : basename(uploadPath);
  print(`\n✓ Queued ${label} for upload`);
  logger.info('Channel upload queued', { count: jobs.length, chatId: options.chatId });

  return { kind: 'queued', jobIds: jobs.map(j => j.id) };
}
