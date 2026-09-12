// Resolves the directories the CLI reads configuration from and writes logs,
// sessions and locks into.
//
// These differ between the two ways this code runs:
//   - from source (tsx / compiled dist/), where the project checkout is writable
//   - from a compiled single-file binary, where the module itself lives in a
//     read-only virtual filesystem and nothing may be written next to it
//
// Everything here is deliberately dependency-free: the logger imports this
// module while deciding where to put its log files, so it must not import the
// logger back.
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * True when running inside a compiled single-file binary.
 * Bun mounts embedded sources under a virtual `/$bunfs/` root, which is not
 * writable and is not a real location on the user's disk.
 */
export const isCompiledBinary = moduleDir.includes('$bunfs');

/**
 * Root of the source checkout. Valid only when running from source — this
 * module sits at `<root>/src/utils/`, and at `<root>/dist/utils/` once built,
 * so the project root is two levels up in both cases.
 */
function getProjectRoot(): string {
  return dirname(dirname(moduleDir));
}

/** Current working directory, or null when it has been deleted underneath us. */
function safeCwd(): string | null {
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

/**
 * Directory to search for a `.env` file living alongside the application:
 * next to the executable for a binary, the project root when run from source.
 */
export function getBaseDirectory(): string {
  return isCompiledBinary ? dirname(process.execPath) : getProjectRoot();
}

/**
 * Directory for persistent user data (sessions, locks, uploads).
 * A binary has no writable install directory, so it uses `~/.tgmanager`.
 * Overridable with TGMANAGER_HOME.
 */
export function getConfigDirectory(): string {
  if (process.env.TGMANAGER_HOME) return process.env.TGMANAGER_HOME;
  return isCompiledBinary ? join(homedir(), '.tgmanager') : getProjectRoot();
}

/** Can this directory be created and written to? */
function isUsableDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory for writable run-time output such as logs.
 * A binary writes beside the invocation (cwd) so logs land where the user is
 * working. Every candidate is probed rather than assumed: the previous
 * packaging sentinel silently became wrong and callers crashed on an
 * unwritable path, so this returns somewhere that actually works.
 */
export function getWritableDataDir(): string {
  const candidates = isCompiledBinary
    ? [safeCwd(), join(homedir(), '.tgmanager')]
    : [getProjectRoot(), join(homedir(), '.tgmanager')];

  for (const candidate of candidates) {
    if (candidate && isUsableDir(candidate)) return candidate;
  }
  return tmpdir();
}
