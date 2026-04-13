# Phase 1 — Quick Wins

**Status:** in progress | **Effort:** ~1 day | **Risk:** low

## Context Links

- Audit: [tech-debt-260413-2241-codebase-audit.md](../reports/tech-debt-260413-2241-codebase-audit.md)
- Items covered: 1, 3, 9, 10, 11, 12, 13

## Steps

1. Delete legacy root `.js` files: `index.js`, `Uploader.js`, `config.js`, `logger.js`, `accounts.js`, `Downloader.js`.
   - First grep to confirm no external `require('./config.js')` etc. Skip if only self-refs or in archived docs.
2. Delete `package-lock.json` and `pnpm-lock.yaml`. Update `.gitignore`: remove `!package-lock.json`; remove `bun.lockb` ignore; add `package-lock.json` + `pnpm-lock.yaml` ignores.
3. `git rm --cached -r` any tracked files under `sessions/`, `locks/`, `dist-pkg/`. Add `locks/` to gitignore.
4. Update `vitest.config.ts`: `coverage.include = ['src/**/*.ts']`, drop `src/storage/index.ts` exclude to `src/**/*.d.ts` etc.
5. Update `Dockerfile`: `FROM node:24-slim` → `FROM node:22-alpine` for builder and runner stages; adjust apk vs apt if alpine.

## Todo

- [x] Grep for `./index.js|./Uploader.js|./config.js|./logger.js|./accounts.js|./Downloader.js` refs outside dist/
- [x] Delete 6 legacy `.js` files
- [x] Delete `package-lock.json`, `pnpm-lock.yaml`
- [x] Patch `.gitignore` for Bun-first, untrack artifacts
- [ ] `git rm --cached locks/nitewalker.lock` — **OUTSTANDING**: file still tracked in HEAD index
- [x] Widen vitest coverage.include
- [x] Dockerfile node:22
- [x] `bun install` sanity; `bun run build:ts`; `bun test`

## Success Criteria

- Build + tests green
- `git status` shows only intended deletions/updates
- `git ls-files` shows no `sessions/**`, `locks/**`, `dist-pkg/**`
