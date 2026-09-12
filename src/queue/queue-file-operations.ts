// src/queue/queue-file-operations.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import logger from '../logger.js';
import type { QueueFile } from './queue-types.js';

/**
 * Get the base queue directory path (~/.tgmanager/queue/)
 */
export function getQueueDir(): string {
  return join(homedir(), '.tgmanager', 'queue');
}

/**
 * Get the queue file path for a specific account
 * @param account - Account identifier (e.g., phone number or session name)
 */
export function getQueueFilePath(account: string): string {
  return join(getQueueDir(), `${account}.queue.json`);
}

/**
 * Read queue from disk for a specific account.
 * Returns empty queue if file doesn't exist.
 * Throws on real errors (permissions, disk, corruption) to avoid masking issues.
 * @param account - Account identifier
 */
export function readQueue(account: string): QueueFile {
  const filePath = getQueueFilePath(account);

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as QueueFile;
  } catch (error: unknown) {
    // File doesn't exist yet — normal for first use
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, jobs: [] };
    }
    // Real errors (permissions, disk full, corrupt JSON) — surface them
    logger.error(`Failed to read queue file for account ${account}`, { error });
    throw error;
  }
}

/**
 * Write queue to disk atomically using temp file + rename pattern.
 * Ensures queue directory exists before writing.
 * @param account - Account identifier
 * @param queue - Queue data to persist
 */
export function writeQueue(account: string, queue: QueueFile): void {
  const queueDir = getQueueDir();
  const filePath = getQueueFilePath(account);
  const tempPath = `${filePath}.tmp`;

  // Ensure queue directory exists
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true });
  }

  try {
    // Write to temp file first
    const content = JSON.stringify(queue, null, 2);
    writeFileSync(tempPath, content, 'utf-8');

    // Atomic rename
    renameSync(tempPath, filePath);
  } catch (error) {
    logger.error(`Failed to write queue file for account ${account}`, { error });
    throw error;
  }
}
