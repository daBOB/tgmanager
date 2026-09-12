# Phase 1: Extend StoredFileInfo with Hash + Add findByHash

## Context Links
- [storage-service.ts](/src/storage/storage-service.ts) -- main target
- [manifest-manager.ts](/src/storage/manifest-manager.ts) -- FileManifest type (has `originalHash`)
- [plan.md](plan.md)

## Parallelization Info
- **Can run in parallel with:** Phase 2
- **Blocks:** Phase 3 (needs `findByHash`)
- **Blocked by:** nothing

## Overview
- **Priority:** High
- **Status:** pending
- Add `originalHash` to `StoredFileInfo` interface and populate it from parsed manifests in `listStoredFiles()`. Add `findByHash()` method.

## Key Insights
- `FileManifest` already contains `originalHash` (SHA-256)
- `listStoredFiles()` already parses full manifest per message -- just not extracting hash into `StoredFileInfo`
- Single-field addition + one new method; minimal surface area

## Requirements
- `StoredFileInfo.originalHash` field (string, from manifest)
- `StorageService.findByHash(hash: string): Promise<StoredFileInfo | null>` method
- No breaking changes to existing `listStoredFiles()` consumers

## Architecture
No structural changes. `findByHash` delegates to `listStoredFiles()` + filter (same pattern as existing `findByPath`).

## Related Code Files
- **Modify:** `src/storage/storage-service.ts`

## File Ownership
This phase exclusively owns `src/storage/storage-service.ts`. No other phase touches it.

## Implementation Steps

1. Add `originalHash: string` to `StoredFileInfo` interface (after `size` field, line ~19)

2. In `listStoredFiles()`, add `originalHash` to the object pushed to `files[]` array (line ~380):
   ```ts
   files.push({
     fileId: manifest.fileId,
     originalName: manifest.originalName,
     virtualPath: fullPath,
     size: manifest.originalSize,
     originalHash: manifest.originalHash,  // ADD THIS
     status: manifest.status,
     createdAt: manifest.createdAt,
     manifestMessageId: message.id
   });
   ```

3. Add `findByHash` method after `findByPath` (~line 409):
   ```ts
   /**
    * Find file by content hash (SHA-256)
    */
   async findByHash(hash: string): Promise<StoredFileInfo | null> {
     const allFiles = await this.listStoredFiles();
     return allFiles.find(f => f.originalHash === hash) || null;
   }
   ```

## Todo List
- [ ] Add `originalHash: string` to `StoredFileInfo` interface
- [ ] Populate `originalHash` in `listStoredFiles()`
- [ ] Add `findByHash()` method
- [ ] Verify `npx tsc --noEmit` passes

## Success Criteria
- `StoredFileInfo` includes `originalHash`
- `findByHash("abc123")` returns matching file or null
- TypeScript compiles without errors

## Conflict Prevention
No other phase modifies `storage-service.ts`.

## Risk Assessment
- **Low risk** -- additive change only, no behavior modification of existing methods
- Existing callers of `listStoredFiles()` unaffected (new field is additive)

## Security Considerations
None -- hash is read-only from manifests, no user input involved.

## Next Steps
Phase 3 uses `findByHash()` for content-based dedup in upload command.
