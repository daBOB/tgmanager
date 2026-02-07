---
title: "Upload Queue for Storage Commands"
description: "JSON file-based FIFO upload queue with worker-in-process model and queue management CLI commands"
status: pending
priority: P1
effort: 6h
branch: main
tags: [queue, upload, cli, storage]
created: 2026-02-06
---

# Upload Queue Implementation Plan

## Problem
CLI currently runs one `upload-storage` per invocation and exits. No way to enqueue multiple uploads; second invocation is rejected by process lock.

## Solution
JSON file queue at `~/.tgmanager/queue/{account}.queue.json`. CLI adds job to queue; if no worker active, caller becomes worker and drains queue FIFO. `--wait` flag blocks until job completes. New `queue-status` and `queue-cancel` commands.

## Architecture
```
CLI invocation
  |-> add job to queue file (atomic read-modify-write)
  |-> try acquire worker lock
      |-> YES: become worker -> loop { dequeue -> upload -> mark done } -> exit
      |-> NO: if --wait, poll queue file for job status -> exit
                else print position and exit
```

## Phases

| # | Phase | Files Owned | Depends On | Effort | Parallel Group |
|---|-------|-------------|------------|--------|----------------|
| 1 | [Queue data layer](phase-01-queue-data-layer-types-and-json-file-manager.md) | `src/queue/queue-manager.ts`, `src/queue/queue-types.ts` | - | 2h | A |
| 2 | [Worker loop](phase-02-worker-loop-drain-queue-and-execute-uploads.md) | `src/queue/queue-worker.ts` | Phase 1 | 1.5h | B |
| 3 | [CLI integration](phase-03-cli-integration-route-upload-storage-through-queue.md) | `src/index.ts`, `src/utils/validation.ts` | Phase 1, 2 | 1.5h | C |
| 4 | [Queue management commands](phase-04-queue-management-commands-status-and-cancel.md) | `src/commands/queue-status-command.ts`, `src/commands/queue-cancel-command.ts` | Phase 1 | 1h | A |

## Dependency Graph
```
Phase 1 (queue data layer)
  |-> Phase 2 (worker loop)
  |     |-> Phase 3 (CLI integration)
  |-> Phase 4 (queue commands) -- parallel with Phase 2
```

## Execution Strategy
1. **Parallel Group A**: Phase 1 + Phase 4 (Phase 4 can stub queue-manager imports)
2. **Sequential**: Phase 2 after Phase 1
3. **Sequential**: Phase 3 after Phase 1 + Phase 2

Realistically: Phase 1 first, then Phase 2 + Phase 4 in parallel, then Phase 3.

## File Ownership Matrix

| File | Phase | Operation |
|------|-------|-----------|
| `src/queue/queue-types.ts` | 1 | CREATE |
| `src/queue/queue-manager.ts` | 1 | CREATE |
| `src/queue/queue-worker.ts` | 2 | CREATE |
| `src/commands/queue-status-command.ts` | 4 | CREATE |
| `src/commands/queue-cancel-command.ts` | 4 | CREATE |
| `src/index.ts` | 3 | MODIFY |
| `src/utils/validation.ts` | 3 | MODIFY |

## Key Decisions
- JSON file queue (no SQLite) -- KISS, no new deps
- Worker-in-process, no daemon -- simplest lifecycle
- Atomic writes via temp-file + rename (same pattern as manifest-manager)
- Reuse existing `ProcessLock` for worker exclusivity
- `--wait` uses polling (500ms) on queue file, not IPC
