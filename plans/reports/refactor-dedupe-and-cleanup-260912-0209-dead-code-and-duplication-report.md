# Refactor: Dedupe + Cleanup — 2026-09-12

Scope: remove dead code, eliminate duplication. No behavior change intended.

## Tooling defect found first (blocked accurate analysis)

`tests/utils/validation.test.ts` contained **literal** control bytes (`0x00`, `0x1F`, `0x7F`)
inside test string literals. Whole file registered as *binary* to grep/ripgrep →
silently excluded from every code search, including Claude's `Grep` tool.

Consequence: first dead-code pass falsely reported `validatePath` unused — it has 7
references in that very file. Any audit relying on search would repeat the error.

Fix: literal bytes → escape sequences (`\x00`, `\x1F`, `\x7F`). Identical runtime
strings, file is plain ASCII and searchable again. Verified: grep now returns 7 hits
for `validatePath` (was 0).

Note: the `grep` shell function in this environment drops such matches entirely.
Used `/usr/bin/grep` + a Python scanner for all analysis after this.

## Dead code removed (7 exports)

Each verified zero references across `src/`, `tests/`, `docs/`, `README.md`, incl.
string/dynamic lookups. `package.json` has no `exports` map; `main`/`bin` both point
at the CLI entry → no library API surface, so removal is not a breaking change.

| Symbol | File |
|---|---|
| `logApiCall`, `logError`, `SanitizedParams` | `src/logger.ts` |
| `hasQueuedWork` | `src/queue/queue-worker.ts` |
| `deleteManifest` | `src/storage/manifest-manager.ts` |
| `UploadResult`, `ValidationResult<T>` | `src/types/index.ts` |
| `validateFileExists` (+ orphaned `statSync`/`Stats` imports) | `src/utils/validation.ts` |

Other dead-code categories scanned, all clean: unreachable code (none), commented-out
code (none), unused imports (none — eslint `no-unused-vars` is an error and passes).

Remaining unreferenced-externally exports are used *internally* (error classes, config
interfaces) — over-exported, not dead. Left alone.

## Deduplication (3 sites)

**1. `src/Uploader.ts` — biggest win.** `uploadMP4File` / `uploadDocument` were
near-identical ~35-line bodies (progress-bar lifecycle, flood-wait retry, success log,
error handling) differing only in send options + error label. Extracted private
`sendFileWithProgress(chatId, filePath, startTime, errorMessage, extraOptions)`.

- `startTime` is a parameter specifically to preserve exact timing semantics: MP4
  starts the clock *before* `getVideoInfo()` (ffprobe), as before. Not doing this
  would have silently changed the logged upload duration.
- Merged options object is equivalent — no key collisions between the base object
  and `extraOptions`.
- A now-redundant `as UploadOptions` assertion was dropped (eslint flagged it; tsc agrees).
- `extraOptions` is typed `Partial<Omit<UploadOptions, 'file' | 'caption' | 'progressCallback'>>`.
  The extraction spreads `extraOptions` last, so a plain `Partial<UploadOptions>` would let a
  future caller silently detach the progress bar. `Omit` makes that invariant compiler-enforced
  rather than convention. (Raised by code review; applied.)

**2. Process-liveness check — duplicated 3rd copy.** `ProcessLock.isProcessRunning`
was a private byte-equivalent of the exported `isProcessAlive`. (A prior pass merged
two copies but missed this private one.) Canonical impl moved to new
`src/utils/process-liveness.ts`; `queue-process-utils.ts`, `queue-file-lock.ts` and
`process-lock.ts` all import it.

Placed in `utils/` deliberately — the old export lived in `queue/`, and having
`utils/process-lock.ts` import from `queue/` would invert the layering. Matches the
existing `src/utils/sleep.ts` single-purpose-util precedent.

**3. Stream teardown.** The `writeStream.end()` promise wrapper was copy-pasted in
`file-chunk-splitter.ts` and `file-chunk-merger.ts`. Extracted `closeWriteStream()`
into the existing `src/storage/file-split-utils.ts` (already the chunk-lifecycle
helper module). Covered by real round-trip split→merge tests.

Only remaining cross-file match is the `storage-service` → `storage-file-downloader`
method signature — intentional facade delegation, not duplication. Left alone.

## Verification

| Gate | Result |
|---|---|
| `bun run type-check` | clean |
| `bun run lint` | **0 errors**, 55 warnings (was 61; none new) |
| `bun run test` | **97/97 passing**, 7 files — stable over 5 consecutive runs |
| `bun run compile` | native binary builds (639 modules) |

Net: ~100 lines removed from `src/`, one new 15-line util. All files remain under 200 lines.

Docs checked — no doc references any removed symbol, nothing made stale.

Code review (`code-reviewer` agent), two passes, **no defects in either**:

- Pass 1 — dead-code removal, `Uploader.ts` dedup, encoding fix. Behavior confirmed preserved
  per branch. Its one suggestion (the `Omit` hardening above) was applied.
- Pass 2 — liveness + stream consolidations, and the hardening. Confirmed specifically:
  `process-liveness.ts` is a leaf module (zero imports, cannot cycle); `isProcessRunning` has
  zero remaining references; `acquire()` branch structure identical pre/post, including the
  stale-pid path; `closeWriteStream` preserves reject-on-late-write-error at both sites; and
  the merger's per-chunk `pipe(writeStream, { end: false })` is unaffected — the single
  explicit close after the loop is unchanged in position, so the shared writeStream still
  ends at exactly the same point.

## Unresolved questions

1. **`isProcessAlive` treats EPERM as dead.** `process.kill(pid, 0)` throws `EPERM`
   when the process exists but is owned by another user; current impl returns `false`
   → "not running". Latent bug, now in exactly one place. Pre-existing behavior,
   preserved deliberately (out of scope for a no-behavior-change refactor). Worth
   fixing? Affects stale-lock stealing and stale-job recovery on shared machines.
2. ~~**`needsSplitting(fileSize, _isPremium)`** keeps an unused `_isPremium` param.~~
   **RESOLVED** in the `/simplify` pass below — param dropped, and the live
   `GetFullUser` API call that only fed it was removed too.
3. **Pre-existing import cycle, NOT introduced here, NOT fixed** (out of scope, flagged only):
   `src/cli/command-dispatcher.ts:13` imports `handleUploadStorageQueue` from
   `upload-storage-queue-handler.ts`, which at `:5` imports `startClient` back from
   `command-dispatcher.ts`. Real value cycle, not type-only. Currently harmless (ESM
   resolves it lazily at call time; type-check/tests/compile all pass) but fragile.
   Clean fix: move `startClient` into its own module. Both files carry substantial
   uncommitted prior-session changes, so mixing this in was deliberately avoided.
   A cycle scan across `src/` found this one and no others — the new
   `process-liveness.ts` and `file-split-utils.ts` edges add none.
4. Over-exported internal types (`ChecksumResult`, `CommandContext`, `QueueOutcome`,
   config interfaces) could drop `export`. Cosmetic; not done.

---

# Follow-up: `/simplify` pass — 2026-09-12 02:17

Scope: whole uncommitted working tree (47 modified files + 1028 lines of new
untracked source). Four parallel review agents — reuse, simplification,
efficiency, altitude. Quality only, not bug-hunting.

## Applied (11 fixes)

**Efficiency**
1. `storage-file-finder.ts` — `findByHash`/`findByPath` no longer materialise
   `[...appended, ...walked]` per lookup; new private `find()` scans `appended`
   then the cached walk in place. `listByPath` filters each side instead of
   concatenating first. A queue drain appends after every job, so the old form
   cost O(jobs x history) copying — e.g. 500 files against a 50k-manifest
   channel ≈ 25M wasted element copies, on the exact path the caching was added
   to speed up. Order semantics (appended first, newest) preserved.

**Wasted work / dead weight**
2. `needsSplitting(fileSize, _isPremium)` → `needsSplitting(fileSize)`. The
   param was documented as "kept for API compatibility" — there is no external
   API, and the threshold is deliberately account-type independent.
3. Removed the live Telegram `GetFullUser` round-trip in
   `upload-storage-command.ts` that existed *only* to compute that discarded
   arg — one fewer network call per `upload-storage` invocation.
4. Removed the resulting orphan `checkPremiumStatus` helper and its `Api` /
   `TelegramClient` imports (`upload-storage-telegram-utils.ts`: 28 → 13 lines).
   Note `Uploader` has its own *cached* premium check; this was an uncached
   second implementation.
5. Tests: 4 `needsSplitting` cases → 3, same size coverage (1GB/3GB under,
   5GB over), minus the account-type arg. Suite 97 → 96 by design.

**Altitude**
6. `uploadStorageCommand`'s `existingStorage?: StorageService` → required
   `storage`. Its sole caller (`queue-worker`) always passes an initialised
   instance, so `?? new StorageService(...)` and the conditional
   `initializeStorageChannel()` were unreachable. Dropped orphaned
   `storageChannelId` binding; `StorageService` is now `import type`.
   NOT done: the reviewer's larger "shared storage factory" idea — speculative
   with one caller (YAGNI).
7. `config.ts` — the last `console.warn` outside `console-output.ts` now routes
   through `printError`. The diff introduced `console-output.ts` claiming to be
   "the only module permitted to call console"; that invariant now actually
   holds (verified: zero `console.` elsewhere in `src/`). Same stream (stderr),
   no output change.

**Indirection / reuse**
8. `queueDirectory` — dropped the injected `addJobs` parameter (one call site,
   no substitution anywhere); it loads `addJobs` where it uses it, matching the
   dynamic-import style already in that file. Dropped the now-unused `QueueJob`
   type import.
9. `config.ts` imports `getConfigDirectory` from `utils/runtime-paths.js`
   directly; deleted `config-loader.ts`'s pass-through re-export.
10. `storage-file-uploader.ts` imports `sleep` from `utils/sleep.js` directly;
    deleted `storage-channel-manager.ts`'s re-export.
11. `tests/queue/queue-manager.test.ts` uses the shared `makeTempDir` fixture
    instead of hand-rolling `mkdtempSync` — the other three suites already do.

## Skipped (with reasons)

- **`upload-directory-command.ts` → `walkDirectory`.** Flagged as re-deriving
  the hidden-entry filter. But `walkDirectory` RECURSES and the current code is
  deliberately flat — adopting it changes what `upload <dir>` uploads. Behavior
  change, not a cleanup. (Side note surfaced by the reviewer: the flat listing
  doesn't exclude subdirectories, so a nested dir is passed to `uploadFile` and
  fails. That is a bug, not a quality issue — out of scope here.)
- **Flood-wait retry restarts a whole chunk download** on a mid-transfer 420
  (`storage-file-downloader.ts`). No cheap fix without chunk-level resume —
  that is a feature, not a cleanup. Bounded by chunk size.
- **Tightening `no-console`** from `['warn', {allow:['warn','error']}]` to
  `'error'`. The rule as written cannot enforce the invariant it documents.
  After fix #7 there are zero violations, so it would pass — but the eslint
  config states a deliberate warnings-as-tech-debt / errors-as-defects policy,
  and changing what fails CI is the maintainer's call. **Open question.**
- **Unifying `ProcessLock` + `queue-file-lock` behind one `PidLockFile`
  primitive.** The reviewer marked it not-required; the two genuinely differ
  (long-held exclusive lock with `force` vs short spin-lock with timeout).
- **`src/storage/index.ts` and `src/commands/index.ts`** are barrel files with
  ZERO importers — dead files. Pre-existing, untouched by the reviewed diff, so
  left alone per scope. Trivially deletable on request. (My earlier dead-export
  scan missed them because `export *` carries no named symbol.)

## Verification

type-check clean · lint **0 errors**, 52 warnings (was 55; none new) ·
**96/96 tests** across 7 files, stable over 6 consecutive runs · native binary
compiles (639 modules) · zero `console.` outside `console-output.ts` ·
dead-export re-scan: none.
