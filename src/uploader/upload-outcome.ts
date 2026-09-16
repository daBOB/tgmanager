// The result of an upload attempt, carrying why it failed.
//
// A bare boolean was the whole problem: uploadFile answered `false` for an
// empty file, an oversize file, an unreadable file and a rejected API call
// alike, so the queue recorded all four as "Upload returned false" and the real
// reason survived only in the log. Nine failed jobs took a log grep across two
// files to explain.
export type UploadOutcome = { ok: true } | { ok: false; reason: string };

/** A successful upload. */
export const uploadSucceeded: UploadOutcome = { ok: true };

/** A failed upload, with the reason that will be stored on the job. */
export function uploadFailed(reason: string): UploadOutcome {
  return { ok: false, reason };
}
