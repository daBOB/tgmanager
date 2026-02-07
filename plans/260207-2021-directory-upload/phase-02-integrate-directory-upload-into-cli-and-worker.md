# Phase 2: Integrate Directory Upload into CLI and Worker

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: [Phase 1](phase-01-create-recursive-directory-walker-utility.md), [Phase 3](phase-03-update-validation-to-accept-directories.md)
- CLI entry: `src/index.ts` lines 208-227 (upload-storage block)
- Worker: `src/queue/queue-worker.ts`

## Overview
- **Priority**: High (core feature)
- **Status**: pending
- **Description**: Modify the upload-storage CLI block to detect directories, walk them, compute virtual paths, and batch-add queue jobs. Also fix `deleteSource` in the worker -- it is currently a no-op.

## Key Insights
- Current upload-storage block (index.ts:208-227) only handles single files: validates `existsSync`, calls `addJob()` once
- Virtual path computation: given `--file-path /data/mydir` and `--virtual-path /backups/`, file at relative path `sub/file.txt` becomes `/backups/mydir/sub/file.txt` (directory name is included automatically)
- **VALIDATED**: Path = virtualPathBase + dirname + relativePath. The directory name from `--file-path` is always preserved in the virtual path.
- `deleteSource` is stored in QueueJob but **never executed** -- worker passes it to `uploadStorageCommand()` which ignores it. Must add deletion logic in worker after `completeJob()`.
- The `--wait` flag polls a single jobId. For directory uploads with N jobs, we need to either poll all jobs or just report that N jobs were queued and let the worker handle completion.

## Requirements

### Functional
- Detect if `uploadPath` is a directory via `statSync().isDirectory()`
- Walk directory using `walkDirectory()` from Phase 1
- For each file, compute virtual path = `virtualPathBase + '/' + relativePath` (normalize slashes)
- Call `addJob()` for each file
- Print summary: "Queued N files for upload"
- If `--wait` is specified with directory, poll ALL job IDs until all reach terminal state. Exit 0 if all succeed, exit 1 if any fail.
- **VALIDATED**: Before queueing, count files and error if count exceeds MAX_QUEUE_SIZE (1000)
- `--delete-source` deletes each source file individually after its upload succeeds (in worker)
- Do NOT delete the source directory itself

### Non-functional
- Existing single-file behavior unchanged
- Empty directories produce a warning, not an error

## Architecture

### index.ts changes (lines 208-227)

```
if (command === 'upload-storage' && uploadPath && options.virtualPath) {
  const stats = statSync(uploadPath);

  if (stats.isDirectory()) {
    // NEW: directory mode
    const entries = await walkDirectory(uploadPath);
    if (entries.length === 0) {
      console.error('No files found in directory');
      process.exit(1);
    }
    const jobIds: string[] = [];
    for (const entry of entries) {
      const fileVirtualPath = join(options.virtualPath, entry.relativePath);
      const job = addJob(account, {
        filePath: entry.absolutePath,
        virtualPath: normalizeVirtualPath(fileVirtualPath),
        storageChannelId: options.storageChannel,
        deleteSource,
      });
      jobIds.push(job.id);
    }
    console.log(`\n✓ Queued ${entries.length} files for upload`);
    // handle --wait: poll all jobs
  } else {
    // EXISTING: single file mode (unchanged)
    queuedJob = addJob(account, { ... });
  }
}
```

### queue-worker.ts changes

After `completeJob()`, add:
```typescript
if (job.deleteSource) {
  try {
    unlinkSync(job.filePath);
    logger.info('Deleted source file', { filePath: job.filePath });
  } catch (err) {
    logger.error('Failed to delete source file', { filePath: job.filePath, error: ... });
  }
}
```

### Virtual path normalization

Need a small helper to normalize virtual paths (collapse double slashes, ensure leading `/`). Can be inlined or a 3-line function in the same file.

## Related Code Files
- **MODIFY**: `src/index.ts` (lines 208-227, add directory detection + batch queueing)
- **MODIFY**: `src/queue/queue-worker.ts` (add deleteSource handling after completeJob)

## Implementation Steps

1. Add imports to `src/index.ts`: `walkDirectory` from `src/utils/directory-walker.ts`, `posix` from `path`
2. In the upload-storage block (line 208), add `statSync(uploadPath)` check
3. If directory: call `walkDirectory(uploadPath)`, validate non-empty
4. Loop entries, compute virtual path using `path.posix.join(options.virtualPath, entry.relativePath)`
5. Call `addJob()` for each, collect job IDs
6. Print summary count
7. If `--wait` with directory: poll all job IDs in a loop until all terminal
8. If single file: keep existing behavior (unchanged)
9. In `src/queue/queue-worker.ts`: after `completeJob(account, job.id)`, add `unlinkSync` guarded by `job.deleteSource`
10. Import `unlinkSync` in worker

## Todo List
- [ ] Modify `src/index.ts` upload-storage block to detect directories
- [ ] Add directory walking + virtual path computation
- [ ] Add batch `addJob()` loop with summary output
- [ ] Handle `--wait` flag for multiple jobs
- [ ] Fix `deleteSource` in `src/queue/queue-worker.ts` (add `unlinkSync` after `completeJob`)
- [ ] Handle empty directory case (warn + exit)

## Success Criteria
- `upload-storage -f /data/mydir --virtual-path /backups/mydir/` with 3 files in mydir creates 3 queue jobs
- Virtual paths mirror directory structure
- `--delete-source` deletes each file only after its individual upload completes
- Single-file uploads still work identically
- Empty directory prints error and exits with code 1

## Risk Assessment
- **Medium**: Modifying the main CLI entry point -- must not break existing single-file flow
- **Mitigation**: Use `isDirectory()` check as the branch point; `else` branch is existing code unchanged
- **Edge case**: Very large directories (1000+ files) could hit MAX_QUEUE_SIZE -- handled by existing queue manager limit

## Security Considerations
- Virtual paths are constructed from local relative paths + user-provided base. `path.posix.join` normalizes `..` segments, but input validation (Phase 3) already prevents traversal in the `--virtual-path` flag.
- Source file deletion is per-file, never bulk directory removal
