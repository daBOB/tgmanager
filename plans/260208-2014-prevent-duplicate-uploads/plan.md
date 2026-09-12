---
title: "Prevent Duplicate File Uploads"
description: "Add virtual-path and hash-based duplicate detection at queue-add and upload time"
status: pending
priority: P2
effort: 2h
branch: main
tags: [storage, dedup, upload-queue]
created: 2026-02-08
---

## Summary

Prevent duplicate file uploads with two complementary checks:
1. **Path check at queue time** — fast, prevents queue pollution
2. **Hash check at upload time** — catches content dupes across different paths, zero extra cost (hash already computed)

## Dependency Graph

```
Phase 1 (storage-service.ts)  ──┐
                                 ├──> Phase 2 (upload-storage-command.ts)
                                 ├──> Phase 3 (index.ts)
                                 └──> Phase 4 (build)
```

**Parallel:** Phase 2 + Phase 3 can run simultaneously (after Phase 1).
**Sequential:** Phase 1 first. Phase 4 last.

## Phases

| # | Name | Status | Depends | Owned Files |
|---|------|--------|---------|-------------|
| 1 | [Extend StoredFileInfo + findByHash](phase-01-extend-stored-file-info.md) | pending | none | `storage-service.ts` |
| 2 | [Hash dedup in upload command](phase-02-add-hash-dedup-in-upload-storage-command.md) | pending | 1 | `upload-storage-command.ts` |
| 3 | [Path dedup at queue time](phase-03-add-path-dedup-check-at-queue-time-in-cli.md) | pending | 1 | `index.ts` |
| 4 | [Build verification](phase-04-build-verification.md) | pending | 1,2,3 | none |

## File Ownership (Exclusive)

- `src/storage/storage-service.ts` — Phase 1 only
- `src/commands/upload-storage-command.ts` — Phase 2 only
- `src/index.ts` — Phase 3 only

## Validated Decisions

- **Path dupe**: Skip + warn. `--force` overrides.
- **Hash dupe (any path)**: Skip upload entirely. Content already in storage.
- **Directory partial dupes**: Skip dupes only, queue the rest, show per-file counts.
- **Check point**: Path at queue time (init client early), hash at upload time (already computed).
- `StoredFileInfo` gains `originalHash` field from parsed manifests.

## Risk

- `listStoredFiles()` iterates up to 100 messages — adequate for current scale
- Client init at queue time adds ~2-3s latency — acceptable for dupe prevention
- Dir uploads: call `listStoredFiles()` once, filter locally (not N separate API calls)
