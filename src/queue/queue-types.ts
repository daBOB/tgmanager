// src/queue/queue-types.ts

/**
 * Queue job status enum representing the lifecycle of an upload job
 * - pending: Job is waiting to be processed
 * - processing: Job is currently being worked on by a worker
 * - completed: Job finished successfully
 * - failed: Job encountered an error
 * - cancelled: Job was cancelled by user
 */
export type QueueJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * What a job uploads to.
 * - storage: the managed storage channel, addressed by virtualPath (chunked,
 *   manifested, deduplicated).
 * - channel: an arbitrary chat addressed by chatId, sent as a single file.
 *
 * Stored explicitly rather than inferred from which field is set, so the
 * worker's dispatch is obvious and a malformed row cannot be silently
 * misrouted.
 */
export type QueueJobKind = 'storage' | 'channel';

/**
 * Queue job representing a pending upload-storage operation.
 * Each job tracks a single file upload through its entire lifecycle.
 */
export interface QueueJob {
  /** Unique job identifier (UUID) */
  id: string;

  /** What this job uploads to */
  kind: QueueJobKind;

  /** Absolute path to the source file on disk */
  filePath: string;

  /** Where the file appears in the storage tree. Null for channel uploads. */
  virtualPath: string | null;

  /** Destination chat for a channel upload. Null for storage uploads. */
  chatId: string | null;

  /** Optional Telegram channel ID for storage (if not default) */
  storageChannelId?: string;

  /** SHA-256 of the file when queued; null when it was not computed. */
  contentHash: string | null;

  /** Whether to delete source file after successful upload */
  deleteSource: boolean;

  /** Current status of the job */
  status: QueueJobStatus;

  /** ISO timestamp when job was created */
  createdAt: string;

  /** ISO timestamp when job started processing (null if never started) */
  startedAt: string | null;

  /** ISO timestamp when job completed/failed/cancelled (null if still pending/processing) */
  completedAt: string | null;

  /** Error message if job failed (null otherwise) */
  error: string | null;

  /** Process ID of worker handling this job (null if not processing) */
  workerPid: number | null;

  /** Higher runs first; jobs of equal priority run oldest-first. Default 0. */
  priority: number;

  /** ISO timestamp before which the job is not eligible. Null = run as soon as possible. */
  scheduledAt: string | null;
}

/**
 * Input options for adding a new job to the queue.
 * Simplified interface for job creation.
 */
export interface QueueAddOptions {
  /** What this job uploads to. Defaults to 'storage'. */
  kind?: QueueJobKind;

  /** Absolute path to the source file on disk */
  filePath: string;

  /** Where the file appears in the storage tree. Required for storage jobs. */
  virtualPath?: string | null;

  /** Destination chat. Required for channel jobs. */
  chatId?: string | null;

  /** Optional Telegram channel ID for storage (if not default) */
  storageChannelId?: string;

  /** SHA-256 of the file, for duplicate detection. */
  contentHash?: string | null;

  /** Whether to delete source file after successful upload (default: false) */
  deleteSource?: boolean;

  /** Higher runs first (default: 0) */
  priority?: number;

  /** ISO timestamp before which the job must not start (default: immediately) */
  scheduledAt?: string | null;
}

/** Filters accepted when listing jobs. */
export interface QueueListFilter {
  /** Restrict to one status; omit for all. */
  status?: QueueJobStatus;
  /** Cap the number of rows returned. */
  limit?: number;
}
