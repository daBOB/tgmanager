// Shared fixtures for the test suites.
import { beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerKnownAccounts, resetKnownAccounts } from '../../src/queue/queue-account-registry.js';
import { createManifest } from '../../src/storage/manifest-manager.js';
import type { FileManifest } from '../../src/storage/manifest-manager.js';

/**
 * Create a private temp directory for one test file.
 *
 * Vitest runs test files in parallel, so suites must not share a tree: one
 * file's cleanup would otherwise delete another's fixtures mid-run.
 */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `tgmanager-${prefix}-`));
}

/**
 * A temp directory for one test file, removed once the file is done.
 *
 * Use for fixtures the whole suite can share; where one test's leftovers would
 * be visible to the next (a directory a test lists or uploads wholesale), make
 * a per-test directory with `makeTempDir` instead.
 */
export function useTempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Give every test its own queue database by pointing $HOME at a fresh directory.
 *
 * The queue resolves its file under $HOME/.tgmanager when it is first asked, so
 * the handle has to be closed again before $HOME moves on — otherwise the next
 * test keeps writing into the previous one's database.
 */
export function useTempQueueHome(prefix: string): void {
  const realHome = process.env.HOME;
  let tempHome: string;

  beforeEach(() => {
    tempHome = makeTempDir(prefix);
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    const { closeDb, getQueueDbPath } = await import('../../src/queue/queue-database.js');
    closeDb(getQueueDbPath());
    process.env.HOME = realHome;
    rmSync(tempHome, { recursive: true, force: true });
  });
}

/** Build a complete manifest, overriding only the fields a test cares about. */
export function makeManifest(overrides: Partial<FileManifest> & { fileId: string }): FileManifest {
  const base = createManifest(
    overrides.originalName ?? `${overrides.fileId}.bin`,
    overrides.originalPath ?? 'Archive',
    overrides.originalSize ?? 1024,
    overrides.originalHash ?? `hash-${overrides.fileId}`,
    overrides.chunkSize ?? 1024
  );
  return { ...base, status: 'complete', ...overrides };
}

/**
 * Declare the accounts a suite enqueues under, the way the CLI does at startup.
 *
 * The queue refuses to write for an account nobody registered, so every suite
 * that enqueues needs this. Registering keeps that guard live during tests
 * instead of disabling it for them, and resetting afterwards stops one suite
 * from authorising the next.
 */
export function useRegisteredAccounts(...accounts: string[]): void {
  beforeEach(() => registerKnownAccounts(accounts));
  afterEach(() => resetKnownAccounts());
}
