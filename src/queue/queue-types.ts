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
 * Queue job representing a pending upload-storage operation.
 * Each job tracks a single file upload through its entire lifecycle.
 */
export interface QueueJob {
  /** Unique job identifier (UUID) */
  id: string;

  /** Absolute path to the source file on disk */
  filePath: string;

  /** Virtual path in storage (where file will appear in storage tree) */
  virtualPath: string;

  /** Optional Telegram channel ID for storage (if not default) */
  storageChannelId?: string;

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
}

/**
 * Input options for adding a new job to the queue.
 * Simplified interface for job creation.
 */
export interface QueueAddOptions {
  /** Absolute path to the source file on disk */
  filePath: string;

  /** Virtual path in storage (where file will appear in storage tree) */
  virtualPath: string;

  /** Optional Telegram channel ID for storage (if not default) */
  storageChannelId?: string;

  /** Whether to delete source file after successful upload (default: false) */
  deleteSource?: boolean;
}

/**
 * Queue file structure persisted to JSON on disk.
 * Each account has its own queue file in ~/.tgmanager/queue/
 */
export interface QueueFile {
  /** Queue file format version for future compatibility */
  version: 1;

  /** Array of all jobs for this account (pending, processing, completed, failed) */
  jobs: QueueJob[];
}
