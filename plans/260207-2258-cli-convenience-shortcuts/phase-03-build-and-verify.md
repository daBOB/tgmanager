# Phase 3: Build and Verify

## Context Links

- [plan.md](plan.md)
- [phase-01](phase-01-default-account-and-command-aliases.md)
- [phase-02](phase-02-positional-arguments.md)

## Overview

- **Priority:** P3
- **Status:** pending (blocked by Phase 2)
- **Effort:** 30min
- **Description:** Type-check, build, and manually smoke-test all CLI paths.

## Key Insights

- Build: `npm run build:ts` (TypeScript compilation) then optionally `bun run build` (binary bundling).
- Type check: `npx tsc --noEmit`
- No automated tests exist for CLI arg parsing (Commander setup). Manual verification required.
- Binary at `dist/uploader-linux` should be rebuilt after changes.

## Requirements

### Functional
- FR1: `npx tsc --noEmit` passes with zero errors.
- FR2: `npm run build:ts` succeeds.
- FR3: All smoke test scenarios pass.

### Non-Functional
- NF1: README updated with new shorthand syntax examples.

## Related Code Files

### Modify
- `README.md` -- Add shorthand usage examples and `TGMANAGER_DEFAULT_ACCOUNT` docs.

### Verify (no changes)
- `dist/index.js` -- compiled output
- All source files from Phase 1 and Phase 2

## Implementation Steps

1. **Type check**
   ```bash
   npx tsc --noEmit
   ```
   Fix any type errors.

2. **Build TypeScript**
   ```bash
   npm run build:ts
   ```

3. **Smoke tests** (manual, using compiled output)

   **Test 1: Backward compat (flag-based)**
   ```bash
   node dist/index.js -a myaccount -c list-storage
   ```
   Expected: lists storage files (or "no files found").

   **Test 2: Default account from env**
   ```bash
   TGMANAGER_DEFAULT_ACCOUNT=myaccount node dist/index.js -c list-storage
   ```
   Expected: same result as test 1.

   **Test 3: Command alias**
   ```bash
   node dist/index.js -a myaccount -c ls
   ```
   Expected: same result as test 1.

   **Test 4: Positional command**
   ```bash
   TGMANAGER_DEFAULT_ACCOUNT=myaccount node dist/index.js ls
   ```
   Expected: same result as test 1.

   **Test 5: Positional with path**
   ```bash
   TGMANAGER_DEFAULT_ACCOUNT=myaccount node dist/index.js ls /backups/
   ```
   Expected: filtered list.

   **Test 6: store positional usage error**
   ```bash
   TGMANAGER_DEFAULT_ACCOUNT=myaccount node dist/index.js store
   ```
   Expected: usage error message.

   **Test 7: No account, no env**
   ```bash
   unset TGMANAGER_DEFAULT_ACCOUNT && node dist/index.js -c list-storage
   ```
   Expected: error message with available accounts and env var hint.

4. **Update README.md**
   - Add `TGMANAGER_DEFAULT_ACCOUNT` to env var table.
   - Add shorthand usage section after existing Usage section.
   - Add `store`, `get`, `ls` aliases to Available Commands table.
   - Keep existing examples intact.

5. **Optional: Rebuild binary**
   ```bash
   bun run build
   ```

## Todo List

- [ ] Run `npx tsc --noEmit` -- fix any errors
- [ ] Run `npm run build:ts`
- [ ] Smoke test 1: flag-based backward compat
- [ ] Smoke test 2: default account env var
- [ ] Smoke test 3: command alias via -c
- [ ] Smoke test 4: positional command
- [ ] Smoke test 5: positional with path arg
- [ ] Smoke test 6: store usage error
- [ ] Smoke test 7: no account error message
- [ ] Update README.md with new features
- [ ] Rebuild binary (optional)

## Success Criteria

1. Zero type errors.
2. Build succeeds.
3. All 7 smoke tests pass.
4. README documents new features.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Type errors from optional account | Medium | Low | Straightforward fix with type assertion |
| Build failure from import changes | Low | Low | Only adding exports, not changing module structure |

## Security Considerations

No new security surface. README update is documentation only.

## Next Steps

Commit changes, update project changelog and roadmap docs if needed.
