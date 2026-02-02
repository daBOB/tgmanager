---
title: "Telegram Storage Channel with File Splitting"
description: "Virtual filesystem on Telegram with auto file splitting for >2GB files"
status: complete
priority: P1
effort: 8h
branch: main
tags: [storage, file-splitting, telegram, cli]
created: 2026-02-02
completed: 2026-02-02
---

# Telegram Storage Channel with File Splitting

## Overview
Implement virtual filesystem on Telegram channels with automatic file splitting for files exceeding 2GB (4GB premium).

## Architecture
```
src/
├── storage/                    # NEW - Phase 01 + 02
│   ├── file-splitter.ts        # Split/merge logic
│   ├── manifest-manager.ts     # JSON manifest tracking
│   ├── checksum-utils.ts       # SHA-256 verification
│   └── storage-service.ts      # Telegram operations
├── commands/                   # NEW - Phase 03
│   ├── upload-storage.ts       # upload-storage command
│   ├── download-storage.ts     # download-storage command
│   └── list-storage.ts         # list-storage command
└── index.ts                    # MODIFY - add commands
```

## Phase Summary

| Phase | Focus | Effort | Parallel With |
|-------|-------|--------|---------------|
| 01 | Core Utilities (splitter, manifest, checksum) | 2h | - |
| 02 | Storage Service (Telegram ops) | 2h | Phase 01 |
| 03 | CLI Commands Integration | 2.5h | After 01+02 |
| 04 | Integration Testing | 1.5h | After 03 |

## File Ownership Matrix

| File | Owner Phase | Type |
|------|-------------|------|
| `src/storage/file-splitter.ts` | 01 | NEW |
| `src/storage/manifest-manager.ts` | 01 | NEW |
| `src/storage/checksum-utils.ts` | 01 | NEW |
| `src/storage/storage-service.ts` | 02 | NEW |
| `src/commands/upload-storage.ts` | 03 | NEW |
| `src/commands/download-storage.ts` | 03 | NEW |
| `src/commands/list-storage.ts` | 03 | NEW |
| `src/types/index.ts` | 03 | MODIFY (types only) |
| `src/index.ts` | 03 | MODIFY (imports + commands) |
| `tests/storage/*.test.ts` | 04 | NEW |

## Parallel Execution Strategy

```
Timeline:
T0 ─────────────────────────────────────────────────► T8h

Phase 01 ████████░░░░░░░░░░░░░░░░░░░░░░░░  (T0-T2)
Phase 02 ████████░░░░░░░░░░░░░░░░░░░░░░░░  (T0-T2) [PARALLEL]
Phase 03 ░░░░░░░░████████████░░░░░░░░░░░░  (T2-T4.5) [BLOCKED BY 01+02]
Phase 04 ░░░░░░░░░░░░░░░░░░░░██████░░░░░░  (T4.5-T6) [BLOCKED BY 03]
```

## Success Criteria
- [x] Files >2GB auto-split into 3.8GB chunks
- [x] Manifest tracks all chunks with SHA-256 checksums
- [x] Download reconstructs original file with integrity verification
- [x] Virtual paths work (`/photos/2024/vacation.jpg`)
- [x] CLI commands: `upload-storage`, `download-storage`, `list-storage`

## Key Constraints
- Chunk size: 500MB (safety margin for Telegram API)
- Max chunks per file: 256 (128GB theoretical max)
- Naming: `{fileId}-chunk-{index:03d}`
- Storage channel: private channel with manifest messages

## Phase Files
- [Phase 01: Core Utilities](./phase-01-core-utilities-file-splitter-manifest-checksum.md)
- [Phase 02: Storage Service](./phase-02-storage-service-telegram-channel-operations.md)
- [Phase 03: CLI Commands](./phase-03-cli-commands-upload-download-list-storage.md)
- [Phase 04: Testing](./phase-04-integration-testing-storage-commands.md)

## Validation Summary

**Validated:** 2026-02-02
**Questions asked:** 5

### Confirmed Decisions
- **Chunk size:** 3.8GB (user preference - maximizes chunk size while staying under 4GB premium limit)
- **Storage channel:** Auto-create private channel (no manual config needed)
- **Temp storage:** `uploads/.storage-temp/` (inside project directory)
- **Resume support:** Full resume from last successful chunk
- **Small files:** Unified system (all files use storage service with manifest)

### Action Items
- [x] Update chunk size from 500MB to 3.8GB in Phase 01 (file-splitter.ts)
- [x] Add resume tracking to manifest (track `uploaded: boolean` per chunk)
- [x] Modify Phase 02 to check existing chunks before re-uploading
