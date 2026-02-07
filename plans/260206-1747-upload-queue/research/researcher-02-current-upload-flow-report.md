# Current Upload Flow Analysis Report

**Date:** 2026-02-06
**Location:** `/home/andre/Workspace/tgmanager`
**Analysis Scope:** Upload architecture for queue system integration

---

## Executive Summary

Upload flow uses **process-level locking** (not queue). Single account = single process maximum. Concurrent uploads within process via `pLimit`. No built-in queue for multiple upload jobs.

---

## 1. Entry Point & Command Routing

**File:** `src/index.ts` (lines 295-303)

```typescript
// CLI parses args → routes to upload-storage command
else if (command === 'upload-storage' && filePath && options.virtualPath) {
  const { uploadStorageCommand } = await import('./commands/upload-storage-command.js');
  const success = await uploadStorageCommand(client, {
    filePath: uploadPath!,
    virtualPath: options.virtualPath,
    storageChannelId: options.storageChannel,
    deleteSource
  });
  process.exit(success ? 0 : 1);
}
```

**Flow:** Commander → validate → acquire process lock → start client → route command → exit

---

## 2. Process Lifecycle

### Lock Mechanism (lines 176-186)
```typescript
const lockDir = join(config.app.sessionDir, '..', 'locks');
processLock = createProcessLock(lockDir, account);
processLock.setupCleanup();

if (!processLock.acquire()) {
  console.error('\n⚠️  Another instance is already running with this account.');
  process.exit(1);
}
```

**Key Points:**
- **One process per account** (hard limit)
- Lock prevents concurrent TG client sessions
- Lock released in finally block (line 337-340)
- Located in `src/utils/process-lock.ts`

### Client Lifecycle (lines 18-84)
```
startClient() → connect → authenticate → save session → return client
```

**Connection:** Single TG client instance per process, reused for all operations in that execution.

---

## 3. Upload Command Architecture

**File:** `src/commands/upload-storage-command.ts`

### Main Function (lines 34-68)
```typescript
export async function uploadStorageCommand(
  client: TelegramClient,
  options: UploadStorageOptions
): Promise<boolean>
```

**Decision Tree:**
1. Validate file exists
2. Initialize StorageService
3. Check premium status
4. Route: `needsSplitting()` → uploadWithSplitting() OR uploadDirect()

### Size Thresholds (`src/storage/file-splitter.ts:304-313`)
- Premium: 4GB max (no split needed)
- Free: 2GB max (no split needed)
- **Default chunk size:** ~3.7GB (from config, see `DEFAULT_CHUNK_SIZE`)

---

## 4. Upload Flows

### A. Direct Upload (Single File, lines 179-240)
```
hashFile() → createManifest() → uploadChunk() → uploadManifest() → done
```
- Single progress bar
- Single network upload
- No temp files

### B. Split Upload (Large File, lines 73-174)
```
splitFile() → uploadAllChunks() → uploadManifest() → cleanupChunks() → done
```

**Split Process:**
1. `splitFile()` creates temp chunks in `.storage-temp` dir
2. Single-pass: hash + write simultaneously (fd-based, retry on I/O errors)
3. `StorageService.uploadAllChunks()` uploads each chunk sequentially
4. Manifest uploaded with metadata
5. Cleanup temp files

**Error Handling:**
- Cleanup chunks on failure (try/catch in lines 152-173)
- Logs errors, does not retry automatically

---

## 5. Concurrency Model

### Traditional Upload (NOT upload-storage)
**File:** `src/index.ts:221-252`

```typescript
const concurrencyLimit = config.app.maxConcurrentUploads;
const limit = pLimit(concurrencyLimit);

const uploadPromises = files.map((file: string) =>
  limit(async () => {
    return uploadSingleFile(uploader, chatId, file, deleteSource);
  })
);

await Promise.all(uploadPromises);
```

**Behavior:**
- Directory upload = parallel file uploads
- `pLimit` caps concurrent network operations
- **Within single process only**

### Storage Upload (upload-storage command)
**No concurrency** — single file per invocation, process exits after completion.

---

## 6. Existing Locking/Queue Mechanisms

### Grep Results:
Files containing lock/queue/mutex keywords:
- `src/utils/process-lock.ts` ✅ (process-level lock)
- `src/index.ts` ✅ (uses process-lock)
- `src/storage/storage-service.ts` (no queue logic found)
- `src/Uploader.ts` (no queue logic found)
- `src/config.ts` (defines `maxConcurrentUploads`)
- `src/types/index.ts` (type definitions only)

**Verdict:** No job queue, no upload queue, no task queue. Only process lock.

---

## 7. Current Limitations for Queue System

### Blocking Issues:
1. **No job persistence** — crashes lose state
2. **No retry logic** — failed uploads require manual restart
3. **No priority system** — FIFO not possible
4. **No status tracking** — can't list pending/active uploads
5. **Process exit after upload** — can't chain multiple jobs in one process
6. **Single file execution** — batch uploads require multiple CLI invocations

### Dependencies:
- `pLimit` already in use (good for concurrency control)
- Process lock must coexist with queue (lock per worker thread/process)
- Manifest system tracks upload metadata (can be leveraged for queue state)

---

## 8. Integration Points for Queue System

### Option A: In-Process Queue
- Add queue manager before `uploadStorageCommand()` call
- Replace `process.exit()` with continue-next-job logic
- Keep process alive, dequeue → upload → repeat

### Option B: External Queue (Database/Redis)
- Queue service manages jobs table
- CLI adds jobs to queue instead of immediate execution
- Worker process polls queue, executes uploads
- Requires persistent storage (SQLite/Postgres/Redis)

### Option C: File-Based Queue
- JSON files in queue directory
- Lock files per job
- Simple, no external deps, fits current architecture

---

## 9. Code Modules to Modify

**For queue integration:**
1. `src/index.ts` — CLI routing, add queue commands (add/status/cancel)
2. `src/commands/upload-storage-command.ts` — decouple from process exit
3. New: `src/queue/queue-manager.ts` — job CRUD, state machine
4. New: `src/queue/worker.ts` — dequeue → execute → update state
5. `src/utils/process-lock.ts` — potentially extend for queue workers

**Unchanged:**
- `src/storage/*` — upload logic remains same
- `src/Uploader.ts` — traditional upload flow separate
- Manifest/checksum/splitter — all reusable as-is

---

## 10. Architecture Patterns Observed

### Current Design:
- **Synchronous CLI execution** (run → complete → exit)
- **Process isolation** (one account = one process)
- **Stateless** (no job tracking beyond current execution)
- **Simple** (KISS principle, no over-engineering)

### Queue System Must Preserve:
- Process lock per account (prevent concurrent TG sessions)
- Error handling granularity (per-file, per-chunk)
- Progress reporting (reuse existing CLI progress bars)
- Config-driven behavior (chunk sizes, concurrency limits)

---

## Unresolved Questions

1. **Queue persistence:** File-based vs database? SQLite viable?
2. **Worker model:** Single long-running worker or spawn-per-job?
3. **Retry policy:** Exponential backoff? Max retries? Dead letter queue?
4. **Priority:** FIFO only or priority levels (normal/high/low)?
5. **Multi-account:** Queue per account or global queue with account routing?
6. **Concurrency:** Max parallel uploads across all queue workers?
7. **Status API:** REST endpoint, CLI subcommands, or both?
8. **Job cancellation:** Graceful stop (finish current chunk) or immediate kill?
9. **Progress tracking:** Real-time updates or poll-based status checks?
10. **Integration with traditional upload:** Separate queues or unified system?

---

**Report complete. File count: 5 reads. Lines: 144.**
