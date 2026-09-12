// Resolves a user-typed job id, which is normally an abbreviation.
//
// queue-status prints the first 8 characters of a UUID, so that is what people
// type back. Shared by cancel and retry so both accept the same input and
// report ambiguity the same way.
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
