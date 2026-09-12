// Translates between the database's snake_case rows and the QueueJob shape the
// rest of the codebase uses. Isolated here so the manager reads as queue logic
// rather than column plumbing.
import type { QueueJob, QueueJobStatus } from './queue-types.js';

/** A row exactly as SQLite returns it. */
export interface JobRow {
  id: string;
  account: string;
  kind: string;
  file_path: string;
  virtual_path: string | null;
  chat_id: string | null;
  storage_channel_id: string | null;
  content_hash: string | null;
  delete_source: number;
  status: string;
  priority: number;
  scheduled_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  worker_pid: number | null;
}

/** Convert a row into the domain object. */
export function rowToJob(row: JobRow): QueueJob {
  return {
    id: row.id,
    kind: row.kind === 'channel' ? 'channel' : 'storage',
    filePath: row.file_path,
    virtualPath: row.virtual_path,
    chatId: row.chat_id,
    contentHash: row.content_hash,
    // The column is nullable, but the field is optional — keep undefined rather
    // than leaking null into callers that spread this back into options.
    storageChannelId: row.storage_channel_id ?? undefined,
    deleteSource: row.delete_source === 1,
    status: row.status as QueueJobStatus,
    priority: row.priority,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    workerPid: row.worker_pid,
  };
}

/** Positional parameters for the insert statement, in column order. */
export function jobToInsertParams(account: string, job: QueueJob): unknown[] {
  return [
    job.id,
    account,
    job.kind,
    job.filePath,
    job.virtualPath,
    job.chatId,
    job.storageChannelId ?? null,
    job.contentHash,
    job.deleteSource ? 1 : 0,
    job.status,
    job.priority,
    job.scheduledAt,
    job.createdAt,
    job.startedAt,
    job.completedAt,
    job.error,
    job.workerPid,
  ];
}

// node:sqlite describes results as generic records of SQL values, so rows are
// narrowed here — at the one boundary where the schema is known — rather than
// with a cast at every query site.

/** Narrow a single result row; a miss is reported as null, not undefined. */
export function asJobRow(raw: unknown): JobRow | null {
  return (raw as JobRow | undefined) ?? null;
}

/** Narrow a set of result rows. */
export function asJobRows(raw: unknown[]): JobRow[] {
  return raw as JobRow[];
}

/** `changes` is typed number | bigint; queue counts never approach that range. */
export function asCount(changes: number | bigint): number {
  return Number(changes);
}
