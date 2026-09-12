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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id                 TEXT PRIMARY KEY,
  account            TEXT    NOT NULL,
  file_path          TEXT    NOT NULL,
  virtual_path       TEXT    NOT NULL,
  storage_channel_id TEXT,
  delete_source      INTEGER NOT NULL DEFAULT 0,
  status             TEXT    NOT NULL,
  priority           INTEGER NOT NULL DEFAULT 0,
  scheduled_at       TEXT,
  created_at         TEXT    NOT NULL,
  started_at         TEXT,
  completed_at       TEXT,
  error              TEXT,
  worker_pid         INTEGER
);

-- Drives the claim query: highest priority first, then oldest, skipping jobs
-- whose scheduled time has not arrived.
CREATE INDEX IF NOT EXISTS idx_jobs_claim
  ON jobs(account, status, priority DESC, scheduled_at, created_at);

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
  db.exec(SCHEMA);

  connections.set(path, db);
  return db;
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
