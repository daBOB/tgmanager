# Phase 03: CLI Integration -- Route upload-storage Through Queue

## Context Links
- [Plan overview](./plan.md)
- [Phase 01: Queue data layer](./phase-01-queue-data-layer-types-and-json-file-manager.md)
- [Phase 02: Worker loop](./phase-02-worker-loop-drain-queue-and-execute-uploads.md)
- CLI entry point: `src/index.ts` (lines 295-303 for upload-storage routing)
- Validation: `src/utils/validation.ts` (validateCommand function)

## Parallelization
- **Group**: C (must run after Phase 1 + Phase 2)
- **Blocks**: None
- **Blocked by**: Phase 1, Phase 2

## Overview
- **Priority**: P1 -- wires everything together
- **Status**: Pending
- **Description**: Modify `src/index.ts` to route `upload-storage` through the queue instead of direct execution. Add `--wait` flag, new `queue-status` and `queue-cancel` command routing. Update validation for new commands.

## Key Insights
- Current flow: CLI -> acquire process lock -> start client -> uploadStorageCommand -> exit
- New flow: CLI -> add job to queue -> try acquire lock -> if acquired, start client + worker -> exit
- `--wait` without worker lock: poll queue file for job status, print progress, exit when done
- `--wait` with worker lock: become worker, which processes the job naturally
- Must preserve backward compatibility: `upload-storage` still works, just goes through queue
- New commands `queue-status` and `queue-cancel` don't need TG client or process lock

## Requirements

### Functional
- `upload-storage` adds job to queue, then either becomes worker or exits
- `--wait` flag: if not worker, poll until job completed/failed, then exit with appropriate code
- `queue-status` command: list jobs (no TG client needed)
- `queue-cancel` command: cancel a job by ID (no TG client needed)
- Queue commands bypass process lock and TG client initialization
- Exit codes: 0 on success, 1 on failure (preserved from current behavior)

### Non-Functional
- `--wait` polling interval: 500ms
- Queue-only commands respond in <100ms (no network)
- No breaking changes to existing CLI flags

## Architecture

### Modified CLI Flow
```
parse args
  |-> command == 'queue-status' or 'queue-cancel'?
  |     |-> YES: execute directly (no lock, no client) -> exit
  |     |-> NO: continue
  |-> command == 'upload-storage'?
  |     |-> validate file + virtualPath
  |     |-> addJob(account, { filePath, virtualPath, ... })
  |     |-> print "Added to queue (position: N)"
  |     |-> try acquire process lock
  |     |     |-> SUCCESS: start client -> startWorker(account, client) -> exit
  |     |     |-> FAIL (another worker running):
  |     |           |-> --wait? poll job status until done -> exit
  |     |           |-> else: print "Worker active, job queued" -> exit 0
  |-> (other commands unchanged)
```

### Commander.js Changes
- Add `--wait` option to program definition
- Add `queue-status` and `queue-cancel` to valid commands in validation
- Route new commands before process lock acquisition

## Related Code Files

### Files to Modify
| File | Changes | Lines Affected |
|------|---------|---------------|
| `src/index.ts` | Add --wait option, queue routing, queue command routing | ~40 lines added, ~10 lines modified |
| `src/utils/validation.ts` | Add queue-status, queue-cancel to valid commands | ~5 lines modified |

### Reference Files (read-only)
| File | Reason |
|------|--------|
| `src/queue/queue-manager.ts` | addJob, getQueuePosition, getJob (Phase 1) |
| `src/queue/queue-worker.ts` | startWorker, hasQueuedWork (Phase 2) |
| `src/commands/queue-status-command.ts` | Import for routing (Phase 4) |
| `src/commands/queue-cancel-command.ts` | Import for routing (Phase 4) |

## File Ownership
- `src/index.ts` -- EXCLUSIVE to Phase 3
- `src/utils/validation.ts` -- EXCLUSIVE to Phase 3

## Implementation Steps

### Step 1: Update `src/utils/validation.ts`
1. Add `'queue-status'` and `'queue-cancel'` to `validCommands` array (line 95)
2. Add validation block for `queue-cancel`: requires `--name` option (reused as job ID) or a new `--job-id` approach
   - Simpler: reuse `--name` as job ID for cancel (`-n <jobId>`)
   - This avoids adding new Commander options

### Step 2: Add `--wait` option to Commander in `src/index.ts`
1. Add `.option('--wait', 'Wait for queued upload to complete')` to program definition (after line 122)
2. Add `wait?: boolean` to CommandOptions type in `src/types/index.ts` -- **NOTE**: types file is not owned by this phase. Add to Phase 1 queue-types instead, or extend CommandOptions here.
   - Decision: Add `wait` to CommandOptions in `src/types/index.ts`. This is a 1-line addition, acceptable cross-phase touch. Document clearly.

### Step 3: Route queue-only commands before lock acquisition
Insert BEFORE process lock section (before line 176):
```typescript
// Queue management commands (no lock or TG client needed)
if (command === 'queue-status') {
  const { queueStatusCommand } = await import('./commands/queue-status-command.js');
  await queueStatusCommand(account);
  process.exit(0);
}

if (command === 'queue-cancel' && name) {
  const { queueCancelCommand } = await import('./commands/queue-cancel-command.js');
  const success = await queueCancelCommand(account, name);
  process.exit(success ? 0 : 1);
}
```

### Step 4: Replace direct upload-storage execution with queue flow
Replace lines 295-303 with:
```typescript
} else if (command === 'upload-storage' && filePath && options.virtualPath) {
  // Add job to queue
  const { addJob, getQueuePosition } = await import('./queue/queue-manager.js');
  const job = addJob(account, {
    filePath: uploadPath!,
    virtualPath: options.virtualPath,
    storageChannelId: options.storageChannel,
    deleteSource
  });
  const position = getQueuePosition(account, job.id);
  console.log(`\n✓ Added to upload queue (position: ${position})`);

  // Already have lock + client at this point, so become worker
  const { startWorker } = await import('./queue/queue-worker.js');
  const result = await startWorker(account, client);
  process.exit(result.failed > 0 ? 1 : 0);
```

### Step 5: Handle case when lock already held (another worker running)
The current code already exits with error when lock fails (line 181-186). Modify this:
```typescript
if (!processLock.acquire()) {
  // If upload-storage, job is already queued -- handle --wait or exit
  if (command === 'upload-storage' && job) {
    if (options.wait) {
      // Poll for job completion
      const { pollJobStatus } = await import('./queue/queue-manager.js');
      const success = await pollJobStatus(account, job.id);
      process.exit(success ? 0 : 1);
    }
    console.log('Worker is active. Upload queued and will be processed.');
    process.exit(0);
  }
  // Non-queue commands: original behavior
  console.error('\n⚠️  Another instance is already running...');
  process.exit(1);
}
```

**Restructuring note**: This requires moving the addJob call BEFORE lock acquisition. Refactor the upload-storage block to:
1. Validate file + path (before lock)
2. Add to queue (before lock)
3. Try lock
4. If locked: start client + worker
5. If not locked: --wait or exit

### Step 6: Add `pollJobStatus` to queue-manager (Phase 1 scope)
- Actually belongs in Phase 1 `queue-manager.ts`
- Alternative: implement inline in index.ts as simple poll loop (~15 lines)
- Decision: Add `pollJobStatus(account, jobId, intervalMs=500): Promise<boolean>` to queue-manager in Phase 1

### Step 7: Update CommandOptions type
Add to `src/types/index.ts`:
```typescript
wait?: boolean;
```
This is a 1-line change. Owned by Phase 3 as exception (documented in file ownership matrix).

## Todo List
- [ ] Add `--wait` option to Commander program definition
- [ ] Add `wait` to CommandOptions type
- [ ] Add queue-status, queue-cancel to validCommands in validation.ts
- [ ] Insert queue command routing before lock acquisition in index.ts
- [ ] Restructure upload-storage flow: add to queue -> try lock -> worker or wait
- [ ] Handle --wait polling when another worker holds lock
- [ ] Preserve original error behavior for non-queue commands when lock fails
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`
- [ ] Test: `upload-storage` adds job and processes it
- [ ] Test: second invocation while worker active queues job and exits

## Success Criteria
- `upload-storage` goes through queue transparently
- First invocation becomes worker and processes all queued jobs
- Second invocation adds to queue and exits (or waits with --wait)
- `queue-status` and `queue-cancel` work without TG client
- No breaking changes to other commands (upload, create, download-storage, list-storage)
- Exit codes preserved (0 success, 1 failure)

## Conflict Prevention
- `src/index.ts` ONLY modified by Phase 3
- `src/utils/validation.ts` ONLY modified by Phase 3
- `src/types/index.ts` -- 1-line addition (wait field), documented exception
- Phase 4 command files imported but not modified

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Restructuring index.ts breaks other commands | Medium | High | Test all commands after changes |
| --wait polling misses rapid state changes | Low | Low | 500ms interval sufficient; job status is terminal |
| Race: job added but lock acquired before addJob completes | Very Low | Low | addJob is sync (writeFileSync under the hood) |

## Security Considerations
- File path validation preserved (existing validatePath call)
- Queue commands validate account name (existing validation)
- No new network attack surface
- `--wait` reads only local queue file, no network polling

## Next Steps
- After Phase 3, full end-to-end flow is functional
- Manual testing of queue scenarios: single upload, concurrent uploads, --wait, cancel
