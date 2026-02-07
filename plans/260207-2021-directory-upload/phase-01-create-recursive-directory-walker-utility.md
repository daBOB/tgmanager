# Phase 1: Create Recursive Directory Walker Utility

## Context Links
- Plan: [plan.md](plan.md)
- Related: `src/index.ts` lines 274-279 (existing `upload` command directory logic)

## Overview
- **Priority**: High (blocks Phase 2)
- **Status**: pending
- **Description**: Create a standalone utility that recursively walks a directory, returns relative file paths, and skips hidden files/directories.

## Key Insights
- Node.js 22 supports `readdir` with `{ recursive: true }` natively -- no external deps needed
- Existing `upload` command (index.ts:276) uses non-recursive `readdir` and only handles top-level files. We need full recursion for storage uploads.
- Must return relative paths so CLI can compute virtual paths by joining base virtual path + relative path

## Requirements

### Functional
- Accept absolute directory path as input
- Recursively enumerate all files (not directories themselves)
- Return array of objects with `absolutePath` and `relativePath`
- Skip entries whose name starts with `.` (hidden files/dirs)
- Skip subdirectories that start with `.` (don't descend into them)

### Non-functional
- Pure sync/async function, no side effects
- Under 60 lines

## Architecture

```
walkDirectory(dirPath: string) => Promise<DirectoryEntry[]>

DirectoryEntry = { absolutePath: string, relativePath: string }
```

Uses `readdir(dirPath, { withFileTypes: true, recursive: true })`. Filter out hidden entries and directories. Map to absolute + relative paths.

## Related Code Files
- **CREATE**: `src/utils/directory-walker.ts`

## Implementation Steps

1. Create `src/utils/directory-walker.ts`
2. Export `DirectoryEntry` interface: `{ absolutePath: string; relativePath: string }`
3. Export `async function walkDirectory(dirPath: string): Promise<DirectoryEntry[]>`
4. Use `readdir(dirPath, { withFileTypes: true, recursive: true })`
5. Filter: skip entries where any path segment starts with `.`
6. Filter: keep only files (not directories)
7. Map to `{ absolutePath: join(dirPath, entry.parentPath, entry.name), relativePath: join(entry.parentPath, entry.name) }` -- Note: `parentPath` is relative to the `readdir` root in Node 22 recursive mode
8. Sort results by relativePath for deterministic queue ordering

## Todo List
- [ ] Create `src/utils/directory-walker.ts`
- [ ] Export `DirectoryEntry` interface
- [ ] Export `walkDirectory()` function
- [ ] Implement hidden file/directory filtering
- [ ] Sort output by relative path

## Success Criteria
- Calling `walkDirectory('/data/mydir')` on a structure like:
  ```
  /data/mydir/
    a.txt
    .hidden
    sub/
      b.txt
      .git/
        config
  ```
  Returns:
  ```
  [
    { absolutePath: '/data/mydir/a.txt', relativePath: 'a.txt' },
    { absolutePath: '/data/mydir/sub/b.txt', relativePath: 'sub/b.txt' }
  ]
  ```
- `.hidden` and `.git/config` are excluded

## Risk Assessment
- **Low risk**: Node 22 `readdir({ recursive: true })` is stable and well-documented
- **Edge case**: Symlink loops -- `readdir` with `recursive: true` does not follow symlinks by default, so this is safe

## Security Considerations
- Path inputs should already be validated by the CLI layer (Phase 3)
- No user input is processed directly by this utility
