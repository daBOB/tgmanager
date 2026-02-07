---
title: "Directory upload support for upload-storage"
description: "Allow upload-storage to accept directory paths, recursively walking and queuing each file as a separate job"
status: pending
priority: P2
effort: 3h
branch: main
tags: [upload-storage, directory, queue, cli]
created: 2026-02-07
---

# Directory Upload Support for upload-storage

## Summary

Enable `upload-storage -f /path/to/dir --virtual-path /backups/` to recursively walk the directory, compute virtual paths mirroring local structure, and queue each file as a separate job via existing `addJob()`.

## Dependency Graph

```
Phase 1 (directory walker utility)  ──┐
                                      ├──> Phase 4 (type check + build)
Phase 3 (validation updates)  ────────┘
                                      │
Phase 2 (CLI integration)  ───────────┘
       depends on Phase 1 + Phase 3
```

**Parallel**: Phase 1 and Phase 3 can run simultaneously.
**Sequential**: Phase 2 depends on Phase 1 + Phase 3. Phase 4 depends on all.

## File Ownership Matrix

| File | Phase | Action |
|------|-------|--------|
| `src/utils/directory-walker.ts` | 1 | CREATE |
| `src/utils/validation.ts` | 3 | MODIFY |
| `src/index.ts` (lines 208-227) | 2 | MODIFY |
| `src/queue/queue-worker.ts` | 2 | MODIFY |

## Critical Finding: deleteSource Not Implemented

`deleteSource` is stored in `QueueJob` and passed to `uploadStorageCommand()`, but **never acted on**. Neither `upload-storage-command.ts` nor `queue-worker.ts` deletes the source file after success. Phase 2 must fix this in the worker so per-file deletion works for both single-file and directory uploads.

## Phases

| # | Name | Status | Depends On | File |
|---|------|--------|------------|------|
| 1 | Directory walker utility | pending | none | [phase-01](phase-01-create-recursive-directory-walker-utility.md) |
| 2 | CLI integration + worker fix | pending | 1, 3 | [phase-02](phase-02-integrate-directory-upload-into-cli-and-worker.md) |
| 3 | Validation updates | pending | none | [phase-03](phase-03-update-validation-to-accept-directories.md) |
| 4 | Type check + build verify | pending | 1, 2, 3 | [phase-04](phase-04-typecheck-build-verification.md) |

## Validation Summary

**Validated:** 2026-02-07
**Questions asked:** 5

### Confirmed Decisions
- **Virtual path**: Always require `--virtual-path` explicitly (no auto-derive)
- **deleteSource fix**: Fix the no-op bug as part of this feature (in queue-worker.ts)
- **--wait with directories**: Wait for ALL jobs to complete; exit 0 only if all succeed, exit 1 if any fail
- **Queue limits**: Error out before queueing if file count exceeds MAX_QUEUE_SIZE (1000)
- **Path mapping**: Virtual path = base + dirname + relative path. E.g., `-f /data/mydir --virtual-path /backups/` → `/backups/mydir/sub/file.txt`

### Action Items
- [ ] Phase 2: Update virtual path computation to include directory name (base + dirname + relativePath)
- [ ] Phase 2: Add pre-queue file count check against MAX_QUEUE_SIZE
- [ ] Phase 2: Implement multi-job `--wait` polling (wait for ALL job IDs)
