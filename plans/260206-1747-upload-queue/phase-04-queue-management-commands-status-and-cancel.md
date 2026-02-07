# Phase 04: Queue Management Commands -- Status and Cancel

## Context Links
- [Plan overview](./plan.md)
- [Phase 01: Queue data layer](./phase-01-queue-data-layer-types-and-json-file-manager.md)
- Existing command pattern: `src/commands/upload-storage-command.ts`, `src/commands/list-storage-command.ts`

## Parallelization
- **Group**: A (can run in parallel with Phase 2)
- **Blocks**: None (Phase 3 imports these but can stub until ready)
- **Blocked by**: Phase 1

## Overview
- **Priority**: P2 -- UX enhancement, not blocking core functionality
- **Status**: Pending
- **Description**: Implement `queue-status` and `queue-cancel` commands as standalone modules following existing command file patterns.

## Key Insights
- These commands do NOT need TG client or process lock -- pure local file operations
- Follow existing command file pattern: export async function, return boolean
- `queue-status` displays formatted table of jobs with status indicators
- `queue-cancel` removes a pending job by ID (cannot cancel in-progress)
- Keep output simple, terminal-friendly, no external table library needed

## Requirements

### Functional
- `queue-status`: list all jobs for account with id, file name, status, position, created time
- `queue-status`: show summary (total, pending, processing, completed, failed)
- `queue-cancel`: cancel a pending job by ID (partial ID match supported for convenience)
- `queue-cancel`: refuse to cancel processing/completed jobs with clear error message

### Non-Functional
- No TG client dependency
- No external formatting dependencies
- Output fits standard 80-column terminal
- Response time <50ms (local file read only)

## Architecture

### queue-status Output Format
```
Upload Queue (account: nitewalker)

  #  ID        File              Status      Created
  1  a1b2c3d4  large-video.mp4   processing  2 min ago
  2  e5f6g7h8  backup.tar.gz     pending     30 sec ago
  3  i9j0k1l2  photo-album.zip   pending     10 sec ago

Summary: 3 jobs (1 processing, 2 pending)
```

### queue-cancel Output Format
```
✓ Cancelled job a1b2c3d4 (backup.tar.gz)
```
or
```
✗ Cannot cancel job a1b2c3d4: status is "processing"
```

## Related Code Files

### Files to Create
| File | Purpose | Max Lines |
|------|---------|-----------|
| `src/commands/queue-status-command.ts` | Format and display queue status | ~80 |
| `src/commands/queue-cancel-command.ts` | Cancel a pending job | ~50 |

### Reference Files (read-only)
| File | Reason |
|------|--------|
| `src/commands/list-storage-command.ts` | Command file pattern reference |
| `src/queue/queue-manager.ts` | listJobs, cancelJob, getJob (Phase 1) |
| `src/queue/queue-types.ts` | QueueJob type (Phase 1) |

## File Ownership
- `src/commands/queue-status-command.ts` -- EXCLUSIVE to Phase 4
- `src/commands/queue-cancel-command.ts` -- EXCLUSIVE to Phase 4

## Implementation Steps

### Step 1: Create `src/commands/queue-status-command.ts`

1. Import `listJobs` from `../queue/queue-manager.js`
2. Import `QueueJob` type
3. Export `async function queueStatusCommand(account: string): Promise<boolean>`
4. Call `listJobs(account)` to get all jobs
5. If empty: print "No jobs in queue" and return true
6. Filter: show only active jobs (pending + processing) by default; show all if needed
7. Format each job row:
   - Truncate ID to first 8 chars
   - Truncate filename to 20 chars with ellipsis
   - Status with indicator icon (pending, processing, completed, failed, cancelled)
   - Relative time ("2 min ago", "1h ago")
8. Print summary line with counts by status
9. Return true

### Step 2: Implement `formatRelativeTime` helper
- Private function in queue-status-command.ts
- Input: ISO date string
- Output: "just now", "30 sec ago", "5 min ago", "2h ago", "1d ago"
- Simple implementation, no external library

### Step 3: Implement status icons helper
- `pending` -> (no icon, just text)
- `processing` -> (text only, no emoji per project rules)
- `completed` -> (text only)
- `failed` -> (text only)
- `cancelled` -> (text only)

### Step 4: Create `src/commands/queue-cancel-command.ts`

1. Import `getJob`, `cancelJob`, `listJobs` from `../queue/queue-manager.js`
2. Export `async function queueCancelCommand(account: string, jobId: string): Promise<boolean>`
3. Support partial ID match: if jobId.length < 36, search jobs where id starts with jobId
4. If no match: print error, return false
5. If multiple matches: print ambiguous error with matching IDs, return false
6. If job found:
   a. If status is not 'pending': print cannot cancel, show current status, return false
   b. Call `cancelJob(account, job.id)`
   c. Print success with job filename
   d. Return true

## Todo List
- [ ] Create `src/commands/queue-status-command.ts` with formatted output
- [ ] Implement relative time formatting
- [ ] Create `src/commands/queue-cancel-command.ts` with partial ID match
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`

## Success Criteria
- `queue-status` displays readable table of jobs
- `queue-status` works with empty queue (graceful message)
- `queue-cancel` cancels pending jobs by full or partial ID
- `queue-cancel` refuses to cancel non-pending jobs with clear message
- No TG client or process lock required
- Each file under 100 lines

## Conflict Prevention
- Both files are new, no overlap with any other phase
- Only imports from Phase 1 (queue-manager, queue-types)
- Phase 3 imports these files but does not modify them

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Partial ID collision | Very Low | Low | Show all matches, ask user to be more specific |
| Queue file read during worker write | Low | None | Atomic writes ensure consistent reads |

## Security Considerations
- Read-only operations on local files
- No network access
- Account name validated by existing CLI validation before reaching these commands

## Next Steps
- Phase 3 routes CLI commands to these handlers
- Future: add `queue-clear` command to remove all pending jobs
- Future: add `queue-retry` command to re-queue failed jobs
