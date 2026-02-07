# Phase 02: Worker Loop -- Drain Queue and Execute Uploads

## Context Links
- [Plan overview](./plan.md)
- [Phase 01: Queue data layer](./phase-01-queue-data-layer-types-and-json-file-manager.md)
- Current upload command: `src/commands/upload-storage-command.ts`
- Process lock: `src/utils/process-lock.ts`

## Parallelization
- **Group**: B (sequential after Phase 1, parallel with Phase 4)
- **Blocks**: Phase 3
- **Blocked by**: Phase 1

## Overview
- **Priority**: P1 -- core execution engine
- **Status**: Pending
- **Description**: Implement worker loop that claims the process lock, recovers stale jobs, then drains the queue FIFO by calling `uploadStorageCommand` for each job. Exits when queue empty.

## Key Insights
- Existing `uploadStorageCommand` returns `Promise<boolean>` -- can be called in a loop without modification
- Process lock already prevents concurrent TG sessions per account -- worker must hold this lock
- Worker does NOT run as daemon; the CLI invocation that acquires the lock becomes the worker
- Worker must recover stale jobs before starting (crash from previous run)
- CLI progress bars from `uploadStorageCommand` display naturally since worker runs in foreground

## Requirements

### Functional
- Acquire worker lock (reuse ProcessLock) before processing
- Recover stale jobs on startup (call `recoverStaleJobs`)
- Loop: claim next pending job -> execute upload -> mark complete/failed -> repeat
- Exit cleanly when queue empty
- Handle upload failures: mark job as failed, continue to next job
- Cleanup old completed jobs after drain completes

### Non-Functional
- Single Telegram client connection reused across all jobs in a drain cycle
- Graceful shutdown on SIGINT/SIGTERM: finish current upload, mark remaining as pending
- No orphaned temp files from split uploads on worker crash (existing cleanup in upload-storage-command handles this)

## Architecture

### Worker Lifecycle
```
startWorker(account, client)
  |-> recoverStaleJobs(account)
  |-> cleanupCompletedJobs(account)
  |-> loop:
  |     |-> job = claimJob(account, nextPendingJob.id)
  |     |-> if no job: break
  |     |-> console.log("Processing: {file} ({position}/{total})")
  |     |-> success = uploadStorageCommand(client, jobToOptions(job))
  |     |-> if success: completeJob(account, job.id)
  |     |-> else: failJob(account, job.id, "Upload failed")
  |-> console.log("Queue empty, exiting")
```

### Integration with Existing Upload
- `uploadStorageCommand(client, options)` called as-is
- Worker converts `QueueJob` fields to `UploadStorageOptions`
- No changes to upload-storage-command.ts needed

## Related Code Files

### Files to Create
| File | Purpose | Max Lines |
|------|---------|-----------|
| `src/queue/queue-worker.ts` | Worker loop: drain queue, execute uploads, handle errors | ~120 |

### Reference Files (read-only)
| File | Reason |
|------|--------|
| `src/commands/upload-storage-command.ts` | Called by worker for each job |
| `src/utils/process-lock.ts` | Worker lock mechanism |
| `src/queue/queue-manager.ts` | Queue CRUD (from Phase 1) |
| `src/queue/queue-types.ts` | Type definitions (from Phase 1) |

## File Ownership
- `src/queue/queue-worker.ts` -- EXCLUSIVE to Phase 2

## Implementation Steps

### Step 1: Create `src/queue/queue-worker.ts`

1. Import `uploadStorageCommand` from `../commands/upload-storage-command.js`
2. Import queue manager functions: `getNextPendingJob`, `claimJob`, `completeJob`, `failJob`, `recoverStaleJobs`, `cleanupCompletedJobs`, `listJobs`
3. Import `QueueJob` type
4. Import logger

### Step 2: Implement `startWorker` function
```typescript
export async function startWorker(
  account: string,
  client: TelegramClient
): Promise<{ processed: number; failed: number }>
```

1. Call `recoverStaleJobs(account)` -- log count if >0
2. Call `cleanupCompletedJobs(account)` -- remove jobs >24h old
3. Initialize counters: processed=0, failed=0
4. Enter loop:
   a. `nextJob = getNextPendingJob(account)`
   b. If null, break
   c. `job = claimJob(account, nextJob.id)`
   d. If null (race condition), continue
   e. Log: "Processing upload {n}: {basename(job.filePath)}"
   f. try: call `uploadStorageCommand(client, { filePath: job.filePath, virtualPath: job.virtualPath, storageChannelId: job.storageChannelId, deleteSource: job.deleteSource })`
   g. If success: `completeJob(account, job.id)`, processed++
   h. If !success: `failJob(account, job.id, 'Upload returned false')`, failed++
   i. catch(error): `failJob(account, job.id, error.message)`, failed++
5. Return `{ processed, failed }`

### Step 3: Implement `hasQueuedWork` helper
```typescript
export function hasQueuedWork(account: string): boolean
```
- Read queue, return true if any pending or processing jobs exist
- Used by Phase 3 to decide whether to start worker

### Step 4: Implement `convertJobToUploadOptions` helper
- Private function mapping QueueJob fields to UploadStorageOptions
- Keeps the worker loop clean

## Todo List
- [ ] Create `src/queue/queue-worker.ts`
- [ ] Implement `startWorker` with drain loop
- [ ] Implement `hasQueuedWork` helper
- [ ] Implement job-to-options conversion
- [ ] Add logging for each job start/complete/fail
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`

## Success Criteria
- Worker drains all pending jobs sequentially
- Failed uploads marked as failed, worker continues to next job
- Worker exits when queue empty
- Stale jobs recovered on startup
- Single TG client reused across all jobs
- File under 120 lines

## Conflict Prevention
- Only creates `src/queue/queue-worker.ts` -- no overlap with other phases
- Does NOT modify `upload-storage-command.ts` -- calls it as external API
- Does NOT modify `process-lock.ts` -- uses it as-is

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upload crash leaves job stuck in "processing" | Medium | Low | recoverStaleJobs on next worker start |
| TG client disconnect mid-drain | Low | Medium | uploadStorageCommand already handles connection errors; job marked failed |
| Queue file modified externally during drain | Low | Low | Each operation re-reads file; atomic writes prevent corruption |

## Security Considerations
- Worker runs with same permissions as CLI user
- File paths from queue validated by uploadStorageCommand (existsSync check)
- No new network surface -- reuses existing TG client

## Next Steps
- Phase 3 calls `startWorker` from CLI after adding job to queue
- Phase 3 calls `hasQueuedWork` to check if worker needed
