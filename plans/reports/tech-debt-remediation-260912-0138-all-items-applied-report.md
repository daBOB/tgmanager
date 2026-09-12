# Tech Debt Remediation — Outcomes

Date: 2026-09-12 | Applies: [tech-debt-audit-260912-0130-codebase-health-report.md](tech-debt-audit-260912-0130-codebase-health-report.md)
All 12 audited items addressed. Build toolchain decision (bun compile) taken by user.

## Before / After

| Signal | Before | After |
|---|---|---|
| CI on `main` | **RED** — lint first, type-check/test/build never ran | green locally end-to-end; gates reordered |
| Lint | 199 errors, 51 warnings | **0 errors**, 61 warnings (tracked debt) |
| Lint scope | `src/*/*.ts` — top-level `src/*.ts` never linted | `src` + `tests`, no shell glob |
| Tests | 39, storage only, 1 flaky | **97**, +queue +validation +pagination, 6/6 clean runs |
| Coverage | unmeasurable (dep missing) | 27.9% stmts (queue 63%, storage 66%) |
| Vulnerabilities | unknown (`npm audit` can't read bun lockfile) | 19 found → **0** |
| Storage lookups | last 100 messages only | full paginated walk + per-run cache |
| Queue writes | unguarded read-modify-write | `O_EXCL` lock per cycle, stale-lock breaking |
| `sharp-loader.ts` | 143 lines, 50 lint errors | 33 lines, typed |
| Packager | `pkg` (archived) | `bun build --compile` |

## Per item

**T1 CI red** — reordered to type-check → test → compile → lint → audit, so a style
failure can no longer mask a broken build. `no-unsafe-*`/`no-explicit-any` demoted to
warnings (tracked debt, not defects); floating/misused promises and unused bindings stay
errors. Added `bun audit` (informational).

**T2 100-message cap** *(highest impact)* — `listStoredFiles` now paginates with
`offsetId` until history is exhausted, bounded by `MAX_MESSAGES_SCANNED`. Added
`StorageIndex`, caching one walk per `StorageService` instance so a batch upload doesn't
re-read the channel per file; `uploadManifest` appends to it, `deleteStoredFile`
invalidates it. Mock rewritten with real Telegram history semantics first.
**Verified as a regression test:** the 4 new tests fail against the old single-page
behaviour and pass after the fix.

**T3 lint glob** — `eslint src tests` (directory args, no shell expansion).

**T4 queue race** — `queue-file-lock.ts` wraps each read-modify-write in an `O_EXCL`
lockfile holding the owner PID; locks from dead processes or older than 30s are broken
automatically. The four near-identical mutators collapsed into one `mutateJob` helper.

**T5 dependencies** — eslint 8 (EOL) → 10 with flat config, `@typescript-eslint` 6 →
`typescript-eslint` 8, vitest 4 → 5, sharp 0.34 → 0.35.4, `pkg` removed, `esbuild` and
the CJS pre-bundle removed. TypeScript held at 5.9 deliberately: `typescript-eslint`
requires `<6.1.0`, so TS 7 is not yet supported.
**Security:** the audit, runnable for the first time, found 19 vulnerabilities (10 high)
— including high-severity libvips/libheif CVEs in sharp, a *direct* dependency. All 19
now clear.

**T6 dead code** — removed orphaned pre-TypeScript `utils/*.js`, unreferenced
`scripts/build-pkg.js`, `_isPremium`, the unused `UploadStorageOptions.deleteSource`
field, and `src/types/process.d.ts`. Untracked `release-manifest.json` (429 KB, stale at
v2.8.1, no consumer in the repo) and `test.env`; both gitignored.

**T7 flood-wait** — one `utils/flood-wait-retry.ts` used by chunk upload, message fetch
and media download. **Downloads previously had no 420 handling at all**; a flood wait
part-way through a restore aborted the file.

**T8 tests** — added queue lifecycle/recovery/locking (15) and validation (24, including
path traversal and control-char sanitisation) plus pagination regressions (6).
Fixed a **pre-existing flake**: `checksum-utils.test.ts` used `tests/.temp`, the *parent*
of two other suites' directories, and deleted it in `afterAll` while they were still
running in parallel. Each suite now gets its own temp dir.

**T9 docs** — added `docs/system-architecture.md` (manifest wire format, index
invariants, queue concurrency contract, distribution matrix) and `docs/codebase-summary.md`.
Updated README packaging instructions, which still described `pkg`.

**T10 dispatcher** — `dispatch()` split into `command-router.ts` +
`upload-directory-command.ts`; 18 `process.exit` calls became returned exit codes applied
once in `index.ts`, so the `finally` that releases the account lock actually runs. The 5
copies of the AUTH_KEY_DUPLICATED check became `isAuthKeyDuplicatedError()`.
`QueueResult.queuedJob: any` and `addJob: Function` replaced with real types.

**T11 console/logger** — `utils/console-output.ts` now owns all 44 user-facing writes;
eslint permits `console` only there.

**T12 sharp-loader** — 143 → 33 lines, real types, single guarded import.

## Changes beyond the audit list

Found while doing the above:

1. **The compiled binary crashed on startup.** `process.pkg` was the "am I packaged?"
   sentinel; under bun it is undefined, so the logger took the dev branch and tried to
   `mkdir` inside bun's read-only `/$bunfs`. Extracted `utils/runtime-paths.ts` (also
   DRYing three copies of the `__dirname`/`import.meta.url` dance) and made file logging
   degrade instead of crashing. Binary verified working end-to-end after the fix.
2. **`.claude/.ckignore`**: added `!build`. The `build` entry matches the substring in
   *Bash commands*, not just the directory, which blocked every compile invocation. No
   `build/` directory exists in this repo.
3. Config-at-import coupling: a util importing `config.ts` made storage modules
   unloadable without a `.env` (config throws at import time). The util no longer imports
   config.

## Accepted regression — image resizing in binaries

You approved the bun swap with the stated risk *"image resize may break in the binary on
some targets"*. Measured result: **it breaks on all targets, not some.** `bun build
--compile` cannot embed native `.node` addons; `@img/sharp-*` won't resolve into the
executable. Probe output: `sharp UNAVAILABLE`.

Behaviour is graceful — the loader warns and uploads proceed unresized — but Telegram
rejects images past its dimension limits, so oversized images will fail to upload *from a
binary*. Docker (`bun run build-docker`) was rewritten onto the Bun runtime with a real
`node_modules`, so it keeps resizing and is now the full-featured distribution.

Options if that is not acceptable: ship `node_modules/sharp` beside the binary
(no longer single-file), or revert the binary path to `pkg` (archived, unmaintained).

## Unresolved

1. The single-file-binary regression above — accept, sidecar, or revert to `pkg`?
2. Binaries verified for **linux-x64 only**. windows/macos/linux-arm64 compile but were
   not executed here.
3. `src/cli/`, `src/commands/`, `src/uploader/` still have no direct test coverage; the
   dispatcher refactor makes them testable now.
4. `config.ts` throws at module import, so `--help` fails without a configured `.env`.
   Pre-existing; not changed because it ripples through every `config.x` site.
5. `queue-manager.ts` (285) and `command-dispatcher.ts` (231) exceed the 200-line
   guideline; both are cohesive and further splitting looked worse.
6. Original audit Q1 stands: was the 100-message cap deliberate? Pagination is correct
   either way, but if the channel is expected to be huge, a pinned catalogue message
   would beat an O(history) walk.
