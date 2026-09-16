// How large a file this client can actually send, and why.
//
// Two different ceilings apply and the smaller one wins:
//
//   policy    - what Telegram allows the account: 4 GiB premium, 2 GiB regular.
//   transport - what the upload protocol can address. Big files go up through
//               upload.SaveBigFilePart, which accepts at most 8000 parts, and
//               gramjs sends 512 KB parts. That caps a transfer at 3.91 GiB,
//               below the 4 GiB a premium account is otherwise entitled to.
//
// Checking only the policy limit left a gap between 3.91 GiB and 4 GiB where a
// file passed the pre-flight check, uploaded for hours, and was then refused by
// the server with FILE_PARTS_INVALID. One real 3.93 GiB file did exactly that;
// the largest that ever succeeded was 3.80 GiB, and the boundary below sits
// between the two.
import config from '../config.js';
import { uploadSucceeded, uploadFailed, type UploadOutcome } from './upload-outcome.js';

/** Maximum parts Telegram accepts for a single big-file upload. */
export const TELEGRAM_MAX_UPLOAD_PARTS = 8000;

/** Part size gramjs uses for files in this range. */
export const UPLOAD_PART_SIZE_BYTES = 512 * 1024;

/** Largest file the upload protocol can carry, whatever the account allows. */
export const TRANSPORT_MAX_UPLOAD_BYTES = TELEGRAM_MAX_UPLOAD_PARTS * UPLOAD_PART_SIZE_BYTES;

/** Bytes rendered the way the operator reads them in the queue and the logs. */
function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * The effective size limit for an account: the stricter of policy and transport.
 *
 * @param isPremium - whether the account carries Telegram Premium
 */
export function maxUploadBytes(isPremium: boolean): number {
  const policy = isPremium
    ? config.fileProcessing.premium.maxFileSizeBytes
    : config.fileProcessing.regular.maxFileSizeBytes;

  return Math.min(policy, TRANSPORT_MAX_UPLOAD_BYTES);
}

/**
 * Decide whether a file of this size can be sent, before any bytes move.
 *
 * Failing here costs nothing; failing at the server costs the whole transfer,
 * which for a file this size is hours.
 *
 * @param sizeBytes - size of the file on disk
 * @param isPremium - whether the account carries Telegram Premium
 */
export function checkUploadSize(sizeBytes: number, isPremium: boolean): UploadOutcome {
  if (sizeBytes === 0) {
    return uploadFailed('File is empty (0 bytes)');
  }

  const limit = maxUploadBytes(isPremium);
  if (sizeBytes > limit) {
    const accountType = isPremium ? 'premium' : 'regular';
    // Name whichever ceiling actually bound, so the message points at the fix:
    // upgrading the account, or splitting the file.
    const because = limit === TRANSPORT_MAX_UPLOAD_BYTES
      ? `${TELEGRAM_MAX_UPLOAD_PARTS} upload parts x ${UPLOAD_PART_SIZE_BYTES / 1024} KB`
      : `${accountType} account limit`;

    return uploadFailed(
      `File is ${formatGB(sizeBytes)}, over the ${formatGB(limit)} limit for this ` +
      `${accountType} account (${because})`
    );
  }

  return uploadSucceeded;
}
