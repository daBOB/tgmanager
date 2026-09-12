# Phase 3: Add Path-Based Dedup Check at Queue Time in CLI

## Context Links
- [index.ts](/src/index.ts) — main target (lines 263-312, upload-storage queue-add block)
- [storage-service.ts](/src/storage/storage-service.ts) — `findByPath()` already exists
- [plan.md](plan.md)

## Parallelization Info
- **Can run in parallel with:** nothing (needs Phase 1 for StorageService with hash)
- **Blocks:** Phase 4
- **Blocked by:** Phase 1

## Overview
- **Priority:** High
- **Status:** pending
- Before `addJob()`, init Telegram client, check `storage.findByPath(virtualPath)`. Skip with message unless `--force`. For directories, skip dupes only and queue the rest.

## Key Insights
- `StorageService.findByPath()` already exists — returns `StoredFileInfo | null`
- Current flow: queue-add happens BEFORE client init (~line 314+). Must restructure to init client earlier for dedup check.
- For directory uploads: check each file individually, count skipped, queue non-dupes
- `--force` flag already defined in CLI (`options.force`)

## Requirements
- Init Telegram client before queue-add block (move client creation earlier)
- For each file (single or dir entry): `storage.findByPath(virtualPath)` before `addJob()`
- Match found + not `--force`: skip with "already exists at path" message
- Directory mode: skip dupes only, report "Queued X files, skipped Y duplicates"
- No file in queue if path already in storage

## Architecture
```
CLI entry
  → init TG client (moved earlier)
  → init StorageService
  → for each file:
      → storage.findByPath(virtualPath)
        → exists + !force → skip
        → !exists or force → addJob()
  → proceed to worker as normal
```

## Related Code Files
- **Modify:** `src/index.ts`

## File Ownership
This phase exclusively owns `src/index.ts`. No other phase touches it.

## Implementation Steps

1. In the upload-storage block (after validating file/dir exists, before addJob), create StorageService instance:
   ```ts
   // Init client + storage for dedup check
   const { StorageService } = await import('./storage/storage-service.js');
   const storageService = new StorageService(client, channelId);
   ```
   Note: client init needs to happen earlier — may need to move client creation before queue-add block, or create a lightweight client just for dedup.

2. **Single file mode**: before `addJob()`:
   ```ts
   if (!options.force) {
     const existing = await storageService.findByPath(options.virtualPath);
     if (existing) {
       console.log(`⏭  Skipped: "${options.virtualPath}" already exists in storage. Use --force to re-upload.`);
       process.exit(0);
     }
   }
   ```

3. **Directory mode**: in the file loop, before each `addJob()`:
   ```ts
   let skippedCount = 0;
   for (const entry of entries) {
     const fileVirtualPath = posix.join(options.virtualPath, dirName, entry.relativePath);
     if (!options.force) {
       const existing = await storageService.findByPath(fileVirtualPath);
       if (existing) {
         skippedCount++;
         continue;
       }
     }
     const job = addJob(account, { ... });
     jobIds.push(job.id);
   }
   ```

4. Update summary messages:
   - Single: "Skipped: already exists" or "Added to queue (position: N)"
   - Directory: "Queued X files from 'dirname', skipped Y duplicates"

5. Handle edge: directory where ALL files are dupes → "All N files already in storage. Nothing to queue."

## Todo List
- [ ] Init TG client + StorageService before queue-add block
- [ ] Add single-file path dedup check
- [ ] Add per-file path dedup check in directory loop
- [ ] Update summary messages with skip counts
- [ ] Handle all-dupes-in-directory edge case
- [ ] Pass `--force` flag through to upload command options

## Success Criteria
- Re-running same upload-storage command: skipped with message
- `--force` overrides and queues anyway
- Directory mode: skips dupes, queues new files, reports counts
- All dupes in directory: clean message, exit 0

## Conflict Prevention
No other phase modifies `index.ts`.

## Risk Assessment
- **Medium** — restructuring client init order; must not break non-upload commands
- Mitigation: only init client early when command is `upload-storage` and `--force` not set
- Performance: `findByPath()` calls `listStoredFiles()` per check. For N files in dir, that's N API calls. Optimize by calling `listStoredFiles()` once and filtering locally.

## Security Considerations
- No new user input handling; uses existing validated virtualPath
- Client init uses existing session/auth flow
