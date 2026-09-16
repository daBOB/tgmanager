// Shared fixtures for the test suites.
import { beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
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
