# Phase 2: Add Hash-Based Dedup in Upload Storage Command

## Context Links
- [upload-storage-command.ts](/src/commands/upload-storage-command.ts) — main target
- [storage-service.ts](/src/storage/storage-service.ts) — `findByHash()` from Phase 1
- [plan.md](plan.md)

## Parallelization Info
- **Can run in parallel with:** nothing (depends on Phase 1)
- **Blocks:** Phase 4
- **Blocked by:** Phase 1 (needs `findByHash` on StorageService)

## Overview
- **Priority:** High
- **Status:** pending
- After file hash is computed (already happens in upload flow), check `storage.findByHash(hash)`. **Skip upload entirely** if hash exists anywhere in storage — regardless of virtual path.

## Key Insights
- Hash computation already happens: `uploadDirect()` calls `hashFile()`, `uploadWithSplitting()` gets hash from `splitFile()`
- User decision: hash match at ANY path = skip upload (content already stored)
- `force` flag bypasses check (pass through from QueueJob or CLI)
- StorageService instance already available in `uploadStorageCommand()`

## Requirements
- After hashing, call `storage.findByHash(hash)`
- If match found (any path) and not `force`: skip, print "Content already in storage at <path>", return true
- `force` bypasses hash check entirely
- Clean up temp chunks if skipping a split upload

## Architecture
```
uploadDirect() / uploadWithSplitting()
  → hashFile() — already exists
  → storage.findByHash(hash) — NEW
    → match found → skip + return true
    → no match → continue upload
```

## Related Code Files
- **Modify:** `src/commands/upload-storage-command.ts`

## File Ownership
This phase exclusively owns `src/commands/upload-storage-command.ts`.

## Implementation Steps

1. Add `force?: boolean` to `UploadStorageOptions` interface

2. Create helper function:
   ```ts
   async function checkHashDuplicate(
     storage: StorageService, hash: string, force: boolean
   ): Promise<StoredFileInfo | null> {
     if (force) return null;
     return storage.findByHash(hash);
   }
   ```

3. In `uploadDirect()`, after `hashFile()`:
   ```ts
   const existing = await checkHashDuplicate(storage, hash, !!options.force);
   if (existing) {
     console.log(`\n⏭  Skipped: identical content already in storage at "${existing.virtualPath}"`);
     progressBar.stop();
     return true;
   }
   ```

4. In `uploadWithSplitting()`, after `splitFile()` returns manifest:
   ```ts
   const existing = await checkHashDuplicate(storage, manifest.originalHash, !!options.force);
   if (existing) {
     console.log(`\n⏭  Skipped: identical content already in storage at "${existing.virtualPath}"`);
     splitBar.stop();
     await cleanupChunks(manifest, tempDir);
     return true;
   }
   ```

5. Pass `force` from worker: update `queue-worker.ts` to include `force: false` in options — actually worker doesn't own force. The hash check runs with `force=false` by default (undefined is falsy), which is correct: if content already exists, skip even in worker.

## Todo List
- [ ] Add `force?: boolean` to `UploadStorageOptions`
- [ ] Add hash dedup check in `uploadDirect()` after `hashFile()`
- [ ] Add hash dedup check in `uploadWithSplitting()` after `splitFile()`
- [ ] Cleanup temp chunks when skipping split upload

## Success Criteria
- Uploading file whose hash exists in storage: skipped with message
- `force: true` bypasses hash check
- Chunks cleaned up when split upload skipped
- TypeScript compiles

## Conflict Prevention
No other phase modifies `upload-storage-command.ts`.

## Risk Assessment
- **Medium** — modifies upload flow; `force` flag provides escape hatch
- Edge: `findByHash` returns first match only; multiple copies at different paths → only first reported. Acceptable.

## Security Considerations
- Hash comparison uses SHA-256 (collision-resistant)
- No user-supplied hash values
