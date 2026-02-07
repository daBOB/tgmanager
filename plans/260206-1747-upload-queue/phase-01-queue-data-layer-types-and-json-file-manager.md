# Phase 01: Queue Data Layer -- Types and JSON File Manager

## Context Links
- [Plan overview](./plan.md)
- [Queue patterns research](./research/researcher-01-queue-patterns-report.md)
- [Current upload flow analysis](./research/researcher-02-current-upload-flow-report.md)
- Existing atomic write pattern: `src/storage/manifest-manager.ts` (saveManifest uses temp+rename)

## Parallelization
- **Group**: A (can run in parallel with Phase 4 stubs)
- **Blocks**: Phase 2, Phase 3
- **Blocked by**: None

## Overview
- **Priority**: P1 -- foundation for all other phases
- **Status**: Pending
- **Description**: Define queue job types and implement JSON file-based queue manager with atomic read/write, FIFO ordering, and crash recovery.

## Key Insights
- Manifest manager already uses temp-file + rename for atomic writes -- reuse same pattern
- Queue file per account at `~/.tgmanager/queue/{account}.queue.json`
- Low frequency (<10 jobs/min) makes JSON file approach viable (per research)
- Must handle crash recovery: reset "processing" jobs to "pending" on startup

## Requirements

### Functional
- Queue job CRUD: add, get, update status, remove, list
- FIFO ordering by `createdAt` timestamp
- Job statuses: `pending`, `processing`, `completed`, `failed`, `cancelled`
- Crash recovery: detect stale "processing" jobs and reset to "pending"
- Thread-safe atomic writes (temp file + rename)

### Non-Functional
- No external dependencies (use Node fs only)
- Queue file <1MB even with 100+ jobs (JSON is fine)
- Operations complete in <10ms for typical queue sizes

## Architecture

### Queue File Structure
```json
{
  "version": 1,
  "jobs": [
    {
      "id": "uuid",
      "filePath": "/abs/path/to/file",
      "virtualPath": "/storage/path",
      "storageChannelId": "optional",
      "deleteSource": false,
      "status": "pending",
      "createdAt": "ISO-8601",
      "startedAt": null,
      "completedAt": null,
      "error": null,
      "workerPid": null
    }
  ]
}
```

### Data Flow
```
addJob() -> read file -> append job -> atomic write
getNextJob() -> read file -> find first pending -> update to processing -> atomic write -> return job
completeJob(id) -> read file -> update status -> atomic write
recoverStaleJobs() -> read file -> find processing w/ dead PID -> reset to pending -> atomic write
```

## Related Code Files

### Files to Create
| File | Purpose | Max Lines |
|------|---------|-----------|
| `src/queue/queue-types.ts` | Type definitions for queue jobs and queue file | ~50 |
| `src/queue/queue-manager.ts` | Queue CRUD operations, atomic file I/O, crash recovery | ~180 |

### Reference Files (read-only)
| File | Reason |
|------|--------|
| `src/storage/manifest-manager.ts` | Atomic write pattern (saveManifest) |
| `src/utils/process-lock.ts` | PID liveness check (isProcessRunning) |
| `src/config.ts` | sessionDir path for queue file location |

## File Ownership
- `src/queue/queue-types.ts` -- EXCLUSIVE to Phase 1
- `src/queue/queue-manager.ts` -- EXCLUSIVE to Phase 1

## Implementation Steps

### Step 1: Create `src/queue/queue-types.ts`
1. Define `QueueJobStatus` union type: `'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'`
2. Define `QueueJob` interface with fields: id, filePath, virtualPath, storageChannelId?, deleteSource, status, createdAt, startedAt?, completedAt?, error?, workerPid?
3. Define `QueueFile` interface: `{ version: 1, jobs: QueueJob[] }`
4. Export `QueueAddOptions` pick type for addJob input (filePath, virtualPath, storageChannelId?, deleteSource?)

### Step 2: Create `src/queue/queue-manager.ts`
1. Import types, fs, path, crypto (randomUUID), config, logger
2. `getQueueFilePath(account: string): string` -- returns `~/.tgmanager/queue/{account}.queue.json`
3. `readQueue(account: string): QueueFile` -- read + parse JSON, return empty queue if file missing
4. `writeQueue(account: string, queue: QueueFile): void` -- atomic write (temp + rename), ensure dir exists
5. `addJob(account: string, options: QueueAddOptions): QueueJob` -- create job, append, write, return job
6. `getNextPendingJob(account: string): QueueJob | null` -- first pending job by createdAt
7. `claimJob(account: string, jobId: string): QueueJob | null` -- set status=processing, workerPid, startedAt
8. `completeJob(account: string, jobId: string): void` -- set status=completed, completedAt
9. `failJob(account: string, jobId: string, error: string): void` -- set status=failed, error
10. `cancelJob(account: string, jobId: string): boolean` -- set status=cancelled (only if pending)
11. `getJob(account: string, jobId: string): QueueJob | null` -- find by id
12. `listJobs(account: string): QueueJob[]` -- return all jobs
13. `getQueuePosition(account: string, jobId: string): number` -- 1-indexed position among pending jobs
14. `recoverStaleJobs(account: string): number` -- find processing jobs w/ dead PID, reset to pending, return count
15. `cleanupCompletedJobs(account: string, maxAge?: number): number` -- remove completed/failed/cancelled older than maxAge (default 24h)

### Step 3: PID liveness check
- Extract `isProcessRunning(pid: number): boolean` logic from process-lock.ts or duplicate inline (3 lines, DRY not worth coupling)
- Used by `recoverStaleJobs` to detect dead workers

## Todo List
- [ ] Create `src/queue/queue-types.ts` with all type definitions
- [ ] Create `src/queue/queue-manager.ts` with queue CRUD
- [ ] Implement atomic write (temp + rename pattern)
- [ ] Implement crash recovery (recoverStaleJobs)
- [ ] Implement cleanup of old completed jobs
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`

## Success Criteria
- All queue operations work correctly on a single JSON file
- Atomic writes prevent corruption on crash
- `recoverStaleJobs` correctly identifies dead worker PIDs
- TypeScript compiles without errors
- Each file under 200 lines

## Conflict Prevention
- No existing files modified in this phase
- New directory `src/queue/` created exclusively by this phase
- No overlap with Phase 2/3/4 file ownership

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Race condition between two CLI invocations writing queue simultaneously | Low | Medium | Atomic rename makes writes safe; worst case one write wins |
| Queue file corruption from partial write | Low | High | Temp file + rename ensures atomic swap |
| Stale job recovery false positive (PID reuse) | Very Low | Low | PID reuse is rare; worst case job re-processes |

## Security Considerations
- Queue file stored in user home dir (~/.tgmanager/) -- same security model as sessions
- File paths in queue validated before use (existing validatePath logic in Phase 3)
- No sensitive data in queue file (file paths only, no API keys)

## Next Steps
- Phase 2 imports `queue-manager` to implement worker loop
- Phase 3 imports `queue-manager` to add jobs from CLI
- Phase 4 imports `queue-manager` for status/cancel commands
