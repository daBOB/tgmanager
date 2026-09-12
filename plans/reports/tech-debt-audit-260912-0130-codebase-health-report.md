# Tech Debt Audit — tgmanager v2.9.0

Date: 2026-09-12 | Scope: `src/` (4,599 LOC, 39 files), `tests/`, CI, deps, docs
Method: test run, `tsc --noEmit`, eslint, `npm outdated`, CI log inspection, manual read of hot files.

## Health Snapshot

| Signal | Status |
|---|---|
| Tests | 39 pass / 4 files (240ms) — **storage module only** |
| Type-check | clean |
| Lint | **199 errors, 51 warnings** (250 problems) |
| CI on `main` | **RED** — fails at Lint step; type-check/build/test never execute |
| Coverage | **unmeasurable** — `@vitest/coverage-v8` not installed |
| Modularization | good — recent splits landed, largest file 295 LOC |

Scoring: `Priority = (Impact + Risk) × (6 − Effort)`, each 1–5.

## Prioritized Backlog

| # | Item | Type | I | R | E | Score | Est. |
|---|---|---|---|---|---|---|---|
| T1 | CI red on main; lint gate blocks all other gates | Infra | 5 | 4 | 2 | **36** | 2h |
| T2 | Storage index capped at 100 messages, no pagination | Arch | 4 | 5 | 3 | **27** | 4h |
| T3 | `lint` script glob skips top-level `src/*.ts` | Infra | 2 | 3 | 1 | **25** | 5m |
| T4 | Queue JSON read-modify-write race across processes | Arch | 3 | 4 | 3 | **21** | 4h |
| T5 | Dependency rot: eslint 8 EOL, ts-eslint v6, `pkg` archived | Dep | 3 | 4 | 3 | **21** | 6h |
| T6 | Dead code: orphaned `utils/*.js`, stale artifacts, unused fields | Code | 2 | 2 | 1 | **20** | 1h |
| T7 | Flood-wait retry duplicated; downloads have none | Code | 2 | 3 | 2 | **20** | 2h |
| T8 | Test debt: queue/cli/commands/uploader/utils untested | Test | 4 | 4 | 4 | **16** | 12h |
| T9 | Docs mandated by CLAUDE.md missing | Doc | 2 | 2 | 2 | **16** | 4h |
| T10 | `dispatch()` god function, 18 `process.exit`, 5 dup error checks | Code | 3 | 2 | 3 | **15** | 4h |
| T11 | 44 `console.*` calls mixed with winston | Code | 2 | 1 | 3 | **9** | 3h |
| T12 | `sharp-loader.ts` — 3-strategy `any` soup, 50 lint errors | Code | 2 | 2 | 4 | **8** | 3h |

---

## T1 — CI red on main (score 36)

`.github/workflows/ci.yml` runs Lint → Type check → Build → Test, sequential. Lint exits 1 (199 errors), so **the three gates that actually catch regressions never run**. Only CI run in history: `34658283618` = failure on `chore(release): 2.9.0`.

Business case: the repo ships native binaries to users; right now nothing verifies a push compiles or passes tests. Cheapest fix that restores real signal without a 199-error cleanup:

1. Reorder: Type check → Test → Build → Lint.
2. Demote the `no-unsafe-*` / `no-explicit-any` family to `warn` in `.eslintrc.json`, keep genuine-bug rules (`no-control-regex` disabled inline at `validation.ts:167` — intentional sanitization, false positive) as errors.
3. Ratchet back to error per-rule as T5/T12 land.

## T2 — Storage index reads only last 100 messages (score 27)

`src/storage/storage-file-finder.ts:28` — `client.getMessages(channelId, { limit: 100 })`, no pagination. Every lookup funnels through `listStoredFiles`:

- `findByPath` → **`download-storage` reports "not found" for data that exists**
- `findByHash` → hash dedup (`upload-storage-direct-uploader.ts:28`, `upload-storage-split-uploader.ts:47`) silently stops deduping
- `listByPath` / `listStoredFiles` → `list-storage` and the queue-time dup pre-check under-report

Chunks land in the same channel as manifests, so one 10 GB split upload writes ~20+ messages. After a handful of large files, older manifests fall out of the window permanently. Failure is silent — no error, just wrong answers, worsening with usage.

Blocks the in-flight plan `plans/260208-2014-prevent-duplicate-uploads/` — dedup built on this index is unreliable by construction.

Fix: paginate via `iterMessages` with `offsetId`, plus a local manifest index cache (channel msg id → manifest) so repeated `findByHash` during a batch doesn't re-walk the channel. Cache invalidation on `maxId`.

## T3 — Lint script glob bug (score 25)

`"lint": "eslint src/**/*.ts"` — unquoted. Under CI's `sh` (no `globstar`), `src/**/*.ts` degrades to `src/*/*.ts`: top-level `src/index.ts`, `Uploader.ts`, `config.ts`, `logger.ts`, `session-helper.ts`, `config-loader.ts` are **never linted**. Local 250 problems vs CI's 223 confirms the 27-problem blind spot.

Fix: `eslint "src/**/*.ts"` (quote it). 5 minutes.

## T4 — Queue race across processes (score 21)

`queue-file-operations.ts` writes atomically (temp + `renameSync`), but the **read-modify-write cycle** in `queue-manager.ts` is unguarded, and concurrency is by design: `command-dispatcher.ts:207` queues jobs *before* acquiring the lock precisely because a worker may hold it.

Interleave: worker `claimJob` reads → CLI `addJob` reads → worker writes → CLI writes ⇒ the claim is lost, or a new job vanishes. `queue-worker.ts:45` acknowledges the race in a comment but the check-then-write can't detect it.

Fix: `O_EXCL` lockfile (or `proper-lockfile`) around each RMW, or per-job files in a directory so writers never touch a shared document. Second option also removes the full-queue rewrite on every state change.

## T5 — Dependency rot (score 21)

| Package | Current | Latest | Note |
|---|---|---|---|
| eslint | 8.57.1 | 10.10.0 | **8.x EOL since Oct 2024** |
| @typescript-eslint/* | 6.21.0 | 8.70.0 | 2 majors behind; flat-config migration |
| pkg | 5.8.1 | — | **vercel/pkg archived**, no security upkeep |
| sharp | 0.34.5 | 0.35.4 | minor |
| vitest | 4.1.4 | 5.0.0 | |
| commander | 14.0.3 | 15.0.0 | |

Also: `@types/node` pinned above the "latest" tag (24.x vs 22.x) — check intent. `npm audit` is unusable (bun-only lockfile by policy in `.gitignore`); no `bun audit` step in CI ⇒ **zero vulnerability scanning today**.

`pkg` being archived is the load-bearing item: it is the sole reason `sharp-loader.ts` (T12) exists. Replacing it with `bun build --compile` (bun is already the project PM and CI runtime) collapses T12 into T5.

## T6 — Dead code and stale artifacts (score 20)

Cheapest win in the list.

- `utils/errors.js`, `utils/sharp-loader.js`, `utils/validation.js` — tracked, orphaned pre-TypeScript CommonJS copies of `src/utils/*.ts`. Nothing imports them. Grep trap: editing the wrong `validateChatId`.
- `scripts/build-pkg.js` — unreferenced (`package.json` uses `bundle-for-pkg.cjs`).
- `release-manifest.json` — 429 KB generated artifact, **version 2.8.1** while package is 2.9.0. Belongs in a release asset, not the tree.
- `test.env` — tracked; harmless value today, but a tracked `.env`-shaped file invites a real secret.
- `command-dispatcher.ts:76-89` — `_isPremium` dead, kept alive by `void _isPremium;`. Git remembers it.
- `UploadStorageOptions.deleteSource` (`upload-storage-types.ts:8`) — passed at `queue-worker.ts:57` and `upload-storage-queue-handler.ts:110`, **read by no upload path**. Deletion happens only at `queue-worker.ts:66`. A direct caller setting `deleteSource: true` silently gets no deletion.

## T7 — Flood-wait retry duplicated, downloads unprotected (score 20)

Two diverging implementations of the same 420-handling:

- `uploader/flood-wait-retry-handler.ts` — `MAX_FLOOD_WAIT_RETRIES = 10`, reads `config.telegram.floodWaitMultiplier`, pauses progress bar.
- `storage/storage-file-uploader.ts:36-49` — hardcoded `retryCount < 10`, multiplier threaded through 3 call layers as a parameter, no bar handling.

`storage-file-downloader.ts` has **no 420 handling at all** — a flood wait mid-download aborts the whole file. Large restores are exactly where flood waits hit.

Fix: one `withFloodWaitRetry(fn, { onWait })` in `src/utils/`, used by upload, chunk upload, and download. Drops the `floodWaitMultiplier` parameter threading through `StorageService`.

## T8 — Test debt (score 16)

39 tests, all under `tests/storage/`. Zero coverage for:

- `queue/` — a multi-process state machine (claim/complete/fail/cancel/recover). Highest-risk logic in the repo, untested.
- `utils/validation.ts` — path-traversal and input-sanitization guards. **Security-relevant, untested.**
- `cli/`, `commands/`, `uploader/`

`@vitest/coverage-v8` isn't installed, so `--coverage` fails and nobody can see the gap.

Note: `tests/mocks/telegram-client-mock.ts:94` returns `.slice(0, limit || 100)` from an in-memory map, so the suite can never exercise T2's >100-message case. Fixing T2 requires extending the mock with real pagination semantics first.

## T9 — Documentation debt (score 16)

`CLAUDE.md` mandates `docs/{project-overview-pdr, codebase-summary, system-architecture, code-standards, design-guidelines, deployment-guide, project-roadmap}.md`. Present: `changelog.md`, `standalone.md`, 2 troubleshooting notes. The 537-line README is the only architecture reference, and it documents features, not the queue/storage/manifest design.

Priority within this: `system-architecture.md` (manifest format, chunking, queue lifecycle) — the manifest JSON schema is a wire format written into Telegram messages; today it lives only in `manifest-manager.ts`.

## T10 — `dispatch()` god function (score 15)

`src/cli/command-dispatcher.ts:159-295`: CWD guard, account resolution, validation, queue routing, lock acquisition, client start, 7-way command routing, error mapping — one function.

- **18** `process.exit()` calls in the file ⇒ the `finally { processLock.release() }` never executes (`process.exit` skips `finally`). Currently masked by the `process.on('exit')` handler in `process-lock.ts:100`; the redundancy is confusing, not broken.
- **5** copies of the `code === 406 || message.includes('AUTH_KEY_DUPLICATED')` check.
- `process.exit()` everywhere makes the dispatcher untestable — likely why T8 exists.

Fix: handlers return exit codes, one `process.exit` at the `index.ts` boundary; extract `isAuthKeyDuplicated(err)` to `utils/errors.ts`; split routing into a command table.

Note `process-lock.ts:43` — the stale-lock branch calls `this.release()` while `this.locked === false`, so it returns early and deletes nothing. Works only because the subsequent `writeFileSync` overwrites. Misleading; tighten when touched.

## T11 — console/logger split (score 9)

44 `console.*` calls across 11 files alongside winston. No separation between user-facing CLI output and diagnostics. Introduce a thin `ui.ts` (print/success/warn/error) so output is redirectable and testable; keep winston for logs.

## T12 — `sharp-loader.ts` (score 8)

143 lines, **50 lint errors** (20% of the repo's total), 3 load strategies + 4 path guesses, duplicated `.default` / `.sharp` unwrapping. Exists only to survive `pkg` bundling of a native module. Do not refactor in place — it collapses to ~15 lines once T5 replaces `pkg`. Sequence it after T5.

---

## Phased Remediation

Designed to run alongside feature work; no phase blocks the dedup plan longer than Phase 2.

### Phase 1 — Restore the safety net (~3h, do first)
- T3 quote the lint glob (5m)
- T1 reorder CI gates, demote `no-unsafe-*`/`no-explicit-any` to warn, inline-disable `no-control-regex` at `validation.ts:167`
- T6 delete `utils/*.js`, `scripts/build-pkg.js`, `_isPremium`, unused `deleteSource` field; untrack `release-manifest.json` + `test.env`
- Add `@vitest/coverage-v8`, record baseline
- Add `bun audit` step to CI

Exit: CI green, tests/type-check actually gating, coverage number exists.

### Phase 2 — Correctness (~8h, unblocks dedup plan)
- T2 paginate `listStoredFiles` + manifest index cache; extend `telegram-client-mock` with real pagination first
- T4 lockfile around queue RMW (or per-job files)
- Tests for both as written (they are the regression proof)

Exit: dedup plan `260208-2014` can proceed on a trustworthy index.

### Phase 3 — Consolidation (~14h, alongside features)
- T7 single flood-wait helper, extend to downloads
- T8 tests for `queue/` and `utils/validation.ts` (the two highest-risk untested modules); defer `commands/` until T10
- T10 exit-code refactor of `dispatch()` + `isAuthKeyDuplicated` extraction

### Phase 4 — Modernization (~13h, schedule deliberately)
- T5 eslint 9/10 + flat config, ts-eslint 8, re-ratchet demoted rules to error
- T5 replace `pkg` with `bun build --compile`; verify all 4 targets
- T12 collapse `sharp-loader.ts` once `pkg` is gone
- T9 write `system-architecture.md` (manifest schema, chunking, queue lifecycle) + `codebase-summary.md`
- T11 `ui.ts` output layer

---

## Unresolved Questions

1. T2 — is the 100-message limit deliberate (perf cap for huge channels) or oversight? If deliberate, dedup needs a different index entirely (pinned index message?).
2. T5 — is a native single-file binary still a shipping requirement? If users can run `bun`/`node`, `pkg` + `sharp-loader` both delete outright.
3. `@types/node` 24.x vs registry-latest 22.x — intentional pin ahead of the tag, or drift?
4. `release-manifest.json` (1,860 file checksums, v2.8.1) — what consumes it? Untrack only after confirming no release tooling reads it from the tree.
5. Last commit dated 2026-04-14 but CI ran 2026-09-11 — is `main` actually the active branch?
