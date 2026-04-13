# TGManager Tech Debt Audit

**Date:** 2026-04-13 | **Stack:** Node.js/TypeScript, Bun PM | **Branch:** main

## Summary

Codebase has accumulated significant org/architecture debt post-TS migration. Core code quality solid (strict TS, ESLint, error handling) but:

1. Root `.js` files coexist with `src/` TS (legacy, never built)
2. Three competing lockfiles (bun.lockb, package-lock.json, pnpm-lock.yaml)
3. Scattered build outputs (dist/, dist-cjs/, dist-pkg/)
4. No `./docs/` dir despite CLAUDE.md mandate; 6 root `.md` files
5. Test coverage thin: 4 test files for 30 source modules
6. 5 files violate >200 LOC rule

**Total items:** 13 | **Est. remediation:** 8–12 days phased

---

## Priority Table

Priority = (Impact + Risk) × (6 − Effort)

| # | Item | Impact | Risk | Effort | **Pri** |
|---|------|:---:|:---:|:---:|:---:|
| 1 | Root `.js` legacy files coexist with `src/` TS | 4 | 5 | 2 | **36** |
| 2 | Test coverage gap (26/30 modules untested) | 5 | 4 | 3 | **27** |
| 3 | Three competing lockfiles | 4 | 3 | 2 | **28** |
| 4 | Dual dist/ + dist-cjs/ outputs | 4 | 3 | 3 | **21** |
| 5 | Files >200 LOC (5 violators) | 3 | 3 | 3 | **18** |
| 6 | No CI pipeline (.github/workflows missing) | 3 | 3 | 3 | **18** |
| 7 | Outdated deps (13 updates available) | 3 | 2 | 2 | **20** |
| 8 | Docs scattered in root .md files | 3 | 2 | 2 | **20** |
| 9 | dist-pkg/ artifacts in tree | 2 | 2 | 1 | **20** |
| 10 | Duplicate config.js + config.ts | 2 | 2 | 1 | **20** |
| 11 | sessions/ + locks/ tracked in git | 2 | 3 | 1 | **25** |
| 12 | Vitest coverage scoped to storage/ only | 2 | 2 | 1 | **20** |
| 13 | Dockerfile node:24 (non-LTS) | 2 | 1 | 1 | **15** |

---

## Per-Item Detail

### 1. Legacy root `.js` files (Pri 36)
**Files:** `index.js` (224), `Uploader.js` (324), `config.js` (97), `logger.js` (94), `accounts.js` (30), `Downloader.js` (0 bytes).
**Risk:** Accidental imports; dual sources of truth; reader confusion. Never built by `tsc`.
**Fix:** Delete. Verify `package.json` `main`/`bin` point only to `dist/`. Grep for any `require('./index.js')` first.
**Effort:** 2h.

### 2. Test coverage gap (Pri 27)
4 test files (all `src/storage/`); 26 untested modules incl. queue-manager (276 LOC), errors.ts (170 LOC), all `commands/`, `index.ts`.
**Risk:** Concurrent upload, retry, AuthKeyDuplicated paths unverified — past prod incidents.
**Fix:** Add unit tests for queue/, errors/, command smoke tests. Target 70%.
**Effort:** 3–5 days.

### 3. Three lockfiles (Pri 28)
`bun.lockb`, `package-lock.json`, `pnpm-lock.yaml` all present. PM ambiguous → divergent installs across machines/CI.
**Fix:** Pick one (Bun per project hint). Delete others, add to .gitignore.
**Effort:** 1h.

### 4. Dual dist/ + dist-cjs/ (Pri 21)
dist/ (ESM, large), dist-cjs/ (200KB, unused?), dist-pkg/ (3MB pkg bundle). Strategy unclear.
**Fix:** Drop dist-cjs/ if `pkg` esbuilds CJS itself; keep dist/ ESM as canonical. Update `tsconfig.cjs.json`.
**Effort:** 4h.

### 5. Files >200 LOC (Pri 18)
- `storage-service.ts` 519 — split into uploader/downloader/verifier
- `index.ts` 515 — split CLI parser vs dispatcher
- `Uploader.ts` 388 — split core vs retry
- `file-splitter.ts` 311 — split chunker vs validator
- `upload-storage-command.ts` 291 — split progress reporter vs error handler

**Fix:** Modularize per CLAUDE.md kebab-case naming.
**Effort:** 5–8 days. Defer to post-release.

### 6. No CI (Pri 18)
No `.github/workflows/`. Lint/test/build manual. Release undocumented.
**Fix:** Add `ci.yml` (lint+test+build matrix) + `release.yml` (binary publish).
**Effort:** 1 day.

### 7. Outdated deps (Pri 20)
13 outdated incl. sharp 0.33→0.34, vitest 4.0→4.1, eslint 8→10, typescript 5.9→6.0.
**Fix:** Phased upgrade. ESLint 9 = flat config breaking change; TS 6 needs verification.
**Effort:** 1 day.

### 8. Root .md sprawl (Pri 20)
6 root files: README.md, CLAUDE.md, AGENTS.md, AUTH_KEY_DUPLICATED_FIX.md, CHANGELOG_AUTH_FIX.md, SHARP_FIX_README.md, STANDALONE.md. No `./docs/` dir.
**Fix:** Create `./docs/`; move fix guides → `docs/troubleshooting.md`; merge changelogs → `docs/changelog.md`. Keep README/CLAUDE.md at root.
**Effort:** 2h.

### 9. dist-pkg/ in tree (Pri 20)
3MB intermediate pkg artifacts. Now in .gitignore (recent commit) but verify.
**Fix:** Confirm gitignored; delete from working tree.
**Effort:** 15min.

### 10. Duplicate config + logger (Pri 20)
`config.js` + `src/config.ts`; `logger.js` + `src/logger.ts`. Same as item 1; subset.
**Fix:** Delete `.js` versions.
**Effort:** 15min.

### 11. sessions/ + locks/ tracked (Pri 25)
`sessions/nitewalker/`, `locks/nitewalker.lock` in repo. **Security risk** — Telegram session = auth credential.
**Fix:** Add to .gitignore. `git rm --cached -r sessions/ locks/`. **Rotate any leaked sessions immediately.**
**Effort:** 30min — but **rotate creds first**.

### 12. Vitest coverage narrow (Pri 20)
`vitest.config.ts` includes only `src/storage/**`. Coverage reports misleadingly green.
**Fix:** Expand `include` to `src/**`; set `coverage.thresholds`.
**Effort:** 15min.

### 13. Dockerfile node:24 (Pri 15)
Non-LTS, EOL 2025-10. Already past EOL.
**Fix:** Pin `node:22-alpine` (LTS).
**Effort:** 15min + image rebuild test.

---

## Phased Remediation

### Phase 1 — Quick wins (1 day, parallel to features)
- Delete `accounts.js`, `Downloader.js`, `config.js`, `logger.js`, `Uploader.js`, `index.js` (item 1, 10)
- Drop pnpm-lock.yaml + package-lock.json; declare Bun (item 3)
- gitignore + `git rm --cached` sessions/, locks/, dist-pkg/ (items 9, 11) **+ rotate session creds**
- Vitest config: `src/**` (item 12)
- Dockerfile → node:22-alpine (item 13)

### Phase 2 — Medium (3–5 days)
- Create `./docs/`; consolidate root .md files (item 8)
- Reconcile build outputs; drop dist-cjs/ (item 4)
- Upgrade deps in batches (item 7)
- Add CI workflow (item 6)

### Phase 3 — Long-term (5–8 days, post-release)
- Modularize 5 large files (item 5)
- Expand test coverage to 70% (item 2)

---

## Unresolved Questions

1. **Binary vs npm dist?** `pkg` builds suggest standalone CLI; clarifies pkg primary distribution target.
2. **CI/CD release target?** GitHub Releases, npm, Docker Hub? Affects workflow design.
3. **Who/what consumed dist-cjs/** historically — confirm zero external consumers before removal.

---

## Validation Log (2026-04-13 22:54)

| Question | Decision | Impact on plan |
|----------|----------|----------------|
| Canonical PM | **Bun** | Phase 1: delete `package-lock.json` + `pnpm-lock.yaml`; keep `bun.lockb`. Update CI to use `bun install`. |
| sessions/ leak scope | **Private only** | Low urgency. Skip credential rotation. Still `git rm --cached` + gitignore (Phase 1). |
| Dep upgrade appetite | **Patch/minor only** | Phase 2: upgrade sharp, vitest, @types/node, dotenv, commander. Defer ESLint 9 (flat config) + TypeScript 6. |
| dist-cjs/ fate | **Drop** | Phase 2: remove dist-cjs/ build step, delete `tsconfig.cjs.json`. Verify pkg bundler still emits CJS via esbuild. Grep confirms no external consumer before delete. |

**Recommendation:** Proceed. Phase 1 (quick wins) can start immediately. No blockers identified.
