# Phase 3: Update Validation to Accept Directories

## Context Links
- Plan: [plan.md](plan.md)
- Validation file: `src/utils/validation.ts`
- Can run in parallel with Phase 1

## Overview
- **Priority**: High (blocks Phase 2)
- **Status**: pending
- **Description**: Update `validateCommand()` and path validation to accept directory paths for `upload-storage`, not just files.

## Key Insights
- Current `validateCommand()` for `upload-storage` only checks that `filePath` and `virtualPath` are provided -- no file-vs-directory distinction. This is fine and needs no change.
- The real issue is in `src/index.ts` line 210-214: `existsSync(uploadPath)` passes for directories, but the intent was single-file validation. Phase 2 handles the branching logic, so validation just needs to confirm the path exists (file OR directory).
- `validateFileExists()` in validation.ts calls `statSync` and returns `Stats` -- this already works for directories. Name is misleading but no rename needed (YAGNI).
- Virtual path for directories should end with `/` by convention to indicate it's a base path. Could add a warning if it doesn't, but not block.

## Requirements

### Functional
- `validateCommand()` for `upload-storage`: no changes needed (already just checks presence of filePath + virtualPath)
- Add `validatePathExists()` function that accepts both files and directories (alias/wrapper around `validateFileExists` or standalone)
- Virtual path validation: when used with a directory, ensure `--virtual-path` ends with `/` (normalize if not, or warn)

### Non-functional
- Keep validation.ts under 200 lines (currently 154)
- Backward compatible

## Architecture

### Option A (preferred -- minimal change)
The existing `validateFileExists()` already handles directories since `statSync` works on both. The function name is slightly misleading but renaming it would be a breaking change across the codebase. Instead, just ensure the CLI code in Phase 2 uses `statSync` directly (which it already does via `existsSync` + `statSync`).

**Result: No changes to validation.ts needed.**

### Option B (if we want to be explicit)
Add a small helper:

```typescript
export function validatePathExists(filePath: string): { stats: Stats; isDirectory: boolean } {
  const stats = validateFileExists(filePath);
  return { stats, isDirectory: stats.isDirectory() };
}
```

This adds 4 lines. Low value but improves readability.

### Decision: Option A
No validation.ts changes needed. The `existsSync` check in `index.ts` already works for directories. Phase 2's `statSync().isDirectory()` branch handles the rest. This phase becomes a verification-only phase.

## Related Code Files
- **VERIFY** (no modify): `src/utils/validation.ts`

## Implementation Steps

1. Review `validateCommand()` for `upload-storage` -- confirm it only checks `filePath` + `virtualPath` presence (already correct)
2. Review `validateFileExists()` -- confirm `statSync` works for directories (it does)
3. No code changes required. Document that validation accepts directories by design.
4. If during Phase 2 integration a validation gap is found, add targeted fix here.

## Todo List
- [ ] Verify `validateCommand()` accepts directory paths (no code change)
- [ ] Verify `validateFileExists()` works with directories (no code change)
- [ ] Confirm virtual path does not need trailing-slash enforcement

## Success Criteria
- Existing validation functions work correctly when given a directory path
- No new validation errors when `--file-path` points to a directory

## Risk Assessment
- **Very low risk**: No code changes, verification only
- This phase exists to confirm assumptions before Phase 2 proceeds

## Security Considerations
- Path traversal prevention via `validatePath()` already applies to both files and directories
- No new attack surface introduced
