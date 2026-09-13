// SQLite storage for the upload queue.
//
// Replaces a per-account JSON file that was rewritten in full on every
// mutation. That cost grew with the queue (quadratic across a drain) and capped
// the queue at 1000 jobs, and it could not answer questions like "what failed
// last week" without loading everything and scanning it.
//
// One database holds every account, so jobs can be inspected across all of them
// at once. WAL mode lets separate CLI and worker processes read while one
// writes, and `busy_timeout` makes a writer wait its turn instead of failing.
//
// node:sqlite rather than bun:sqlite: the two are equivalent here, but the test
// runner executes under Node, where a bun: import does not resolve. This one
// API works in Bun, in Node, and inside the compiled binaries.
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** Directory holding the queue database. */
export function getQueueDir(): string {
  return join(homedir(), '.tgmanager');
}

/** Path to the queue database; ':memory:' in tests. */
export function getQueueDbPath(): string {
  return join(getQueueDir(), 'queue.db');
}

const TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id                 TEXT PRIMARY KEY,
  account            TEXT    NOT NULL,
  kind               TEXT    NOT NULL DEFAULT 'storage',
  file_path          TEXT    NOT NULL,
  -- Exactly one of these is set, per the kind column: storage jobs address the
  -- storage tree by virtual_path, channel jobs address a chat by chat_id.
  virtual_path       TEXT,
  chat_id            TEXT,
  storage_channel_id TEXT,
  -- SHA-256 of the file as queued. Lets a later enqueue tell that the same
  -- bytes already reached this chat, whatever the file was called.
  content_hash       TEXT,
  delete_source      INTEGER NOT NULL DEFAULT 0,
  status             TEXT    NOT NULL,
  priority           INTEGER NOT NULL DEFAULT 0,
  scheduled_at       TEXT,
  created_at         TEXT    NOT NULL,
  started_at         TEXT,
  completed_at       TEXT,
  error              TEXT,
  worker_pid         INTEGER,
  -- Percent complete of the job currently uploading. Written by the worker so
  -- a separate queue-status process can report progress it cannot otherwise see.
  progress           INTEGER
);
`;

// Created after migrate(), since an index cannot reference a column that an
// older database has not been given yet.
const INDEX_SCHEMA = `
-- Drives the claim query: highest priority first, then oldest, skipping jobs
-- whose scheduled time has not arrived.
CREATE INDEX IF NOT EXISTS idx_jobs_claim
  ON jobs(account, status, priority DESC, scheduled_at, created_at);

-- Answers "have these bytes already gone to this chat?" without scanning.
CREATE INDEX IF NOT EXISTS idx_jobs_content
  ON jobs(account, chat_id, content_hash);

-- Drives history browsing, which is newest-first.
CREATE INDEX IF NOT EXISTS idx_jobs_history
  ON jobs(account, created_at DESC);
`;

// Connections are cached per path rather than as a single global: tests point
// HOME at a fresh directory per case, so the resolved path changes underneath a
// long-lived module.
const connections = new Map<string, DatabaseSync>();

/** Open (or reuse) the queue database and make sure its schema exists. */
export function getDb(path: string = getQueueDbPath()): DatabaseSync {
  const existing = connections.get(path);
  if (existing) return existing;

  if (path !== ':memory:') {
    mkdirSync(getQueueDir(), { recursive: true });
  }

  const db = new DatabaseSync(path);
  // WAL keeps readers working while a writer holds the lock; without the
  // timeout a concurrent writer fails immediately rather than waiting.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(TABLE_SCHEMA);
  migrate(db);
  db.exec(INDEX_SCHEMA);

  connections.set(path, db);
  return db;
}

/**
 * Bring an existing database up to the current schema.
 *
 * CREATE TABLE IF NOT EXISTS leaves an older table untouched, so columns added
 * after a database was first created have to be added explicitly. Each is
 * nullable or defaulted, so no backfill is needed: rows written before `kind`
 * existed are storage jobs, which is what the default says.
 */
function migrate(db: DatabaseSync): void {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(c => c.name)
  );

  if (!columns.has('kind')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'storage'`);
  }
  if (!columns.has('chat_id')) {
    db.exec('ALTER TABLE jobs ADD COLUMN chat_id TEXT');
  }
  if (!columns.has('content_hash')) {
    db.exec('ALTER TABLE jobs ADD COLUMN content_hash TEXT');
  }
  if (!columns.has('progress')) {
    db.exec('ALTER TABLE jobs ADD COLUMN progress INTEGER');
  }
}

/** Close and forget a cached connection. Tests use this between cases. */
export function closeDb(path: string = getQueueDbPath()): void {
  const db = connections.get(path);
  if (!db) return;
  db.close();
  connections.delete(path);
}

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * node:sqlite has no transaction() wrapper, and an uncommitted BEGIN left
 * behind by a thrown error would block every later write on the connection.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
