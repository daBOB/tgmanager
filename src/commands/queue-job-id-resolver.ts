// Resolves a user-typed job id, which is normally an abbreviation.
//
// queue-status prints the first 8 characters of a UUID, so that is what people
// type back. Shared by cancel and retry so both accept the same input and
// report ambiguity the same way.
import { basename } from 'node:path';
import { printError } from '../utils/console-output.js';
import type { QueueJob } from '../queue/queue-types.js';

export type JobIdResolution =
  | { kind: 'found'; job: QueueJob }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: QueueJob[] };

/** Full uuid length; anything shorter is treated as a prefix. */
const FULL_ID_LENGTH = 36;

/**
 * Match `partial` against `jobs` by exact id, or by prefix when abbreviated.
 *
 * Ambiguity is reported rather than guessed at: acting on the wrong job would
 * cancel or restart an unrelated upload.
 */
export function resolveJobId(jobs: QueueJob[], partial: string): JobIdResolution {
  const matches = partial.length >= FULL_ID_LENGTH
    ? jobs.filter(job => job.id === partial)
    : jobs.filter(job => job.id.startsWith(partial));

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'ambiguous', matches };
  return { kind: 'found', job: matches[0]! };
}

/**
 * Resolve a job id and report the failure when it does not land on exactly one
 * job, so callers are left with a job or nothing to do.
 *
 * Cancel and retry both act on a single job typed by hand, and both owe the
 * same explanation when the id misses or matches several — keeping that wording
 * in one place stops the two commands drifting apart.
 *
 * @returns the matched job, or null once the reason has been printed.
 */
export function resolveJobIdOrReport(jobs: QueueJob[], partial: string): QueueJob | null {
  const resolution = resolveJobId(jobs, partial);

  if (resolution.kind === 'none') {
    printError(`Error: No job found with ID starting with "${partial}"`);
    return null;
  }

  if (resolution.kind === 'ambiguous') {
    printError(`Error: Ambiguous job ID "${partial}". Multiple matches found:`);
    for (const match of resolution.matches) {
      printError(`  ${match.id.substring(0, 8)}  ${basename(match.filePath)}  (${match.status})`);
    }
    return null;
  }

  return resolution.job;
}
