// Upload queue operations, backed by SQLite.
//
// Every mutation is a single statement (or one transaction), so there is no
// read-modify-write window for a concurrent process to fall into — the
// lockfile the JSON implementation needed is gone.
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';
import type { QueueJob, QueueAddOptions, QueueListFilter } from './queue-types.js';
import { getDb, getQueueDir, getQueueDbPath, inTransaction } from './queue-database.js';
import { rowToJob, jobToInsertParams, asJobRow, asJobRows, asCount } from './queue-job-row-mapper.js';
import { isProcessAlive } from '../utils/process-liveness.js';
import { pollJobStatusUntilDone } from './queue-process-utils.js';

export { getQueueDir, getQueueDbPath };

const INSERT_SQL = `
  INSERT INTO jobs (id, account, kind, file_path, virtual_path, chat_id,
                    storage_channel_id, content_hash, delete_source, status,
                    priority, scheduled_at, created_at, started_at,
                    completed_at, error, worker_pid)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

/**
 * Ordering shared by claiming and by queue position, so the two agree.
 *
 * rowid breaks ties: created_at has millisecond resolution, and enqueueing a
 * directory inserts thousands of jobs well inside one millisecond, which would
 * otherwise leave their relative order undefined. rowid increases with
 * insertion, so it restores FIFO within a batch.
 */
const CLAIM_ORDER = 'ORDER BY priority DESC, created_at ASC, rowid ASC';

/** Only jobs whose scheduled time has arrived are eligible. */
const ELIGIBLE = `status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?)`;

/** Build a pending job record with a fresh ID and timestamp. */
function buildJob(options: QueueAddOptions): QueueJob {
  return {
    id: randomUUID(),
    kind: options.kind ?? 'storage',
    filePath: options.filePath,
    virtualPath: options.virtualPath ?? null,
    chatId: options.chatId ?? null,
    contentHash: options.contentHash ?? null,
    storageChannelId: options.storageChannelId,
    deleteSource: options.deleteSource ?? false,
    status: 'pending',
    priority: options.priority ?? 0,
    scheduledAt: options.scheduledAt ?? null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    workerPid: null,
  };
}

/** Add a single job to the queue. */
export function addJob(account: string, options: QueueAddOptions): QueueJob {
  return addJobs(account, [options])[0]!;
}

/**
 * Add several jobs at once.
 *
 * Wrapped in a transaction so a directory enqueue either lands whole or not at
 * all, and so the inserts cost one fsync rather than one each.
 */
export function addJobs(account: string, optionsList: QueueAddOptions[]): QueueJob[] {
  const db = getDb();
  const jobs = optionsList.map(buildJob);
  const insert = db.prepare(INSERT_SQL);

  inTransaction(db, () => {
    for (const job of jobs) insert.run(...(jobToInsertParams(account, job) as never[]));
  });

  logger.info('Queued jobs', { account, count: jobs.length });
  return jobs;
}

/**
 * The next job a worker should run: highest priority, then oldest, skipping
 * anything scheduled for later.
 *
 * Read-only — the job may be claimed by another process before this one acts,
 * which `claimJob` detects.
 */
export function getNextPendingJob(account: string): QueueJob | null {
  const row = asJobRow(getDb()
    .prepare(`SELECT * FROM jobs WHERE account = ? AND ${ELIGIBLE} ${CLAIM_ORDER} LIMIT 1`)
    .get(account, new Date().toISOString()));

  return row ? rowToJob(row) : null;
}

/**
 * Take ownership of a job for this process.
 *
 * The status guard in the WHERE clause is what makes the claim exclusive: two
 * workers racing for the same job both run the UPDATE, but only the first
 * matches a pending row. The loser changes nothing and is told so.
 */
export function claimJob(account: string, jobId: string): QueueJob | null {
  const db = getDb();

  const changed = asCount(db
    .prepare(`UPDATE jobs SET status = 'processing', started_at = ?, worker_pid = ?
              WHERE id = ? AND account = ? AND status = 'pending'`)
    .run(new Date().toISOString(), process.pid, jobId, account).changes);

  if (changed === 0) {
    logger.warn('Cannot claim job - not pending or not found', { account, jobId });
    return null;
  }

  logger.info('Claimed job for processing', { account, jobId, workerPid: process.pid });
  return getJob(account, jobId);
}

/** Move a job to a terminal state. */
function finishJob(account: string, jobId: string, status: 'completed' | 'failed' | 'cancelled', error: string | null): boolean {
  const changed = asCount(getDb()
    .prepare(`UPDATE jobs SET status = ?, completed_at = ?, error = ?, worker_pid = NULL
              WHERE id = ? AND account = ?`)
    .run(status, new Date().toISOString(), error, jobId, account).changes);

  if (changed === 0) logger.warn(`Cannot ${status} job - not found`, { account, jobId });
  return changed > 0;
}

/** Mark a job as successfully completed. */
export function completeJob(account: string, jobId: string): void {
  if (finishJob(account, jobId, 'completed', null)) {
    logger.info('Job completed', { account, jobId });
  }
}

/** Mark a job as failed, recording why. */
export function failJob(account: string, jobId: string, error: string): void {
  if (finishJob(account, jobId, 'failed', error)) {
    logger.error('Job failed', { account, jobId, error });
  }
}

/**
 * Cancel a job that has not started. A job already being processed is left
 * alone: its worker is mid-upload and would keep going regardless.
 */
export function cancelJob(account: string, jobId: string): boolean {
  const changed = asCount(getDb()
    .prepare(`UPDATE jobs SET status = 'cancelled', completed_at = ?
              WHERE id = ? AND account = ? AND status = 'pending'`)
    .run(new Date().toISOString(), jobId, account).changes);

  if (changed === 0) {
    logger.warn('Cannot cancel job - not pending or not found', { account, jobId });
    return false;
  }

  logger.info('Job cancelled', { account, jobId });
  return true;
}

/** Get one job by ID. */
export function getJob(account: string, jobId: string): QueueJob | null {
  const row = asJobRow(getDb()
    .prepare('SELECT * FROM jobs WHERE id = ? AND account = ?')
    .get(jobId, account));

  return row ? rowToJob(row) : null;
}

/**
 * List jobs for an account, newest first.
 *
 * The filter is applied in SQL rather than by the caller, so a large history
 * never has to be materialised to answer "show me the failures".
 */
export function listJobs(account: string, filter: QueueListFilter = {}): QueueJob[] {
  const clauses = ['account = ?'];
  const params: unknown[] = [account];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  // Outstanding work is most useful in the order it will actually run; history
  // is most useful newest-first.
  const ordering = filter.order === 'queue' ? CLAIM_ORDER : 'ORDER BY created_at DESC';
  let sql = `SELECT * FROM jobs WHERE ${clauses.join(' AND ')} ${ordering}`;
  if (filter.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = asJobRows(getDb().prepare(sql).all(...(params as never[])));
  return rows.map(rowToJob);
}

/** Count jobs by status in one pass, for summaries. */
export function countJobsByStatus(account: string): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS count FROM jobs WHERE account = ? GROUP BY status')
    .all(account) as unknown as { status: string; count: number }[];

  return Object.fromEntries(rows.map(r => [r.status, r.count]));
}

/**
 * Position of a job in the pending queue, 1-indexed, or -1 if it is not
 * waiting. Counts the jobs that would be claimed ahead of it, using the same
 * ordering the claim query uses.
 */
export function getQueuePosition(account: string, jobId: string): number {
  const job = getJob(account, jobId);
  if (!job || job.status !== 'pending') return -1;

  // Counted against the same three keys the claim order uses, so position and
  // claim sequence cannot disagree.
  const result = getDb()
    .prepare(`SELECT COUNT(*) AS ahead
              FROM jobs, (SELECT priority AS p, created_at AS c, rowid AS r
                          FROM jobs WHERE id = ? AND account = ?) AS target
              WHERE jobs.account = ? AND jobs.status = 'pending'
                AND (jobs.priority > target.p
                  OR (jobs.priority = target.p AND jobs.created_at < target.c)
                  OR (jobs.priority = target.p AND jobs.created_at = target.c
                      AND jobs.rowid < target.r))`)
    .get(jobId, account, account) as { ahead: number } | undefined;

  return (result?.ahead ?? 0) + 1;
}

/**
 * Return jobs stranded in `processing` by a worker that died to the pending
 * pool. A crash between claiming and finishing is invisible to the database —
 * only the absence of the process reveals it.
 */
export function recoverStaleJobs(account: string): number {
  const db = getDb();
  const rows = asJobRows(db
    .prepare(`SELECT * FROM jobs WHERE account = ? AND status = 'processing' AND worker_pid IS NOT NULL`)
    .all(account));

  const stale = rows.filter(row => row.worker_pid !== null && !isProcessAlive(row.worker_pid));
  if (stale.length === 0) return 0;

  const reset = db.prepare(
    `UPDATE jobs SET status = 'pending', worker_pid = NULL, started_at = NULL WHERE id = ?`
  );
  inTransaction(db, () => {
    for (const row of stale) {
      logger.warn('Recovering stale job from dead worker', {
        account, jobId: row.id, workerPid: row.worker_pid,
      });
      reset.run(row.id);
    }
  });

  logger.info(`Recovered ${stale.length} stale jobs`, { account });
  return stale.length;
}

/**
 * Delete finished jobs older than `maxAge`.
 *
 * No longer called automatically: history is worth keeping, and unlike the JSON
 * file it costs nothing per mutation to retain. Exposed for when a queue does
 * need trimming.
 */
export function cleanupCompletedJobs(account: string, maxAge: number = 24 * 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - maxAge).toISOString();
  const changes = asCount(getDb()
    .prepare(`DELETE FROM jobs
              WHERE account = ? AND status IN ('completed','failed','cancelled')
                AND COALESCE(completed_at, created_at) < ?`)
    .run(account, cutoff).changes);

  if (changes > 0) logger.info(`Cleaned up ${changes} old jobs`, { account });
  return changes;
}

/** Wait until a job reaches a terminal state. Resolves true only on success. */
export async function pollJobStatus(
  account: string,
  jobId: string,
  intervalMs: number = 500
): Promise<boolean> {
  return pollJobStatusUntilDone(getJob, account, jobId, intervalMs);
}

/**
 * Content hashes already uploaded to a chat, as one set.
 *
 * Returned in bulk rather than queried per file: enqueueing a directory checks
 * thousands of candidates, and one query beats thousands of round trips.
 * Only jobs that actually completed count — a failed or cancelled job did not
 * put anything in the channel.
 */
export function completedContentHashes(account: string, chatId: string): Set<string> {
  const rows = getDb()
    .prepare(`SELECT DISTINCT content_hash FROM jobs
              WHERE account = ? AND chat_id = ? AND status = 'completed'
                AND content_hash IS NOT NULL`)
    .all(account, chatId) as unknown as { content_hash: string }[];

  return new Set(rows.map(r => r.content_hash));
}
