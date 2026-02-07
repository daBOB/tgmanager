# Phase 4: Type Check and Build Verification

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: Phase 1, 2, 3

## Overview
- **Priority**: High (gate before merge)
- **Status**: pending
- **Description**: Run TypeScript type checker and build to verify all changes compile correctly. Manual smoke test instructions.

## Requirements

### Functional
- `npx tsc --noEmit` passes with zero errors
- `npm run build:ts` produces valid output
- `bun run build` produces working binary (if bun available)

### Non-functional
- No new TypeScript warnings introduced

## Implementation Steps

1. Run `npx tsc --noEmit` -- fix any type errors
2. Run `npm run build:ts` -- verify clean build
3. Verify `src/utils/directory-walker.ts` is included in build output
4. Optionally: run `bun run build` for binary

## Smoke Test Instructions

### Single file (regression)
```bash
node dist/index.js -a testaccount -c upload-storage \
  -f /tmp/test-file.txt \
  --virtual-path /test/single.txt
```
Expected: single job queued, uploaded successfully.

### Directory upload
```bash
mkdir -p /tmp/test-dir/sub
echo "a" > /tmp/test-dir/file1.txt
echo "b" > /tmp/test-dir/sub/file2.txt
echo "c" > /tmp/test-dir/.hidden

node dist/index.js -a testaccount -c upload-storage \
  -f /tmp/test-dir \
  --virtual-path /test/dir/
```
Expected: 2 jobs queued (file1.txt, sub/file2.txt). `.hidden` skipped.

### Delete source
```bash
node dist/index.js -a testaccount -c upload-storage \
  -f /tmp/test-dir \
  --virtual-path /test/dir/ \
  --delete-source
```
Expected: each file deleted after its upload completes. Directory `/tmp/test-dir` remains (with empty subdirs).

## Todo List
- [ ] Run `npx tsc --noEmit`
- [ ] Run `npm run build:ts`
- [ ] Fix any type errors
- [ ] Run smoke tests

## Success Criteria
- Zero TypeScript errors
- Clean build output
- Smoke tests pass

## Risk Assessment
- **Low**: Standard verification step
