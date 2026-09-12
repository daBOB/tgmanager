# Codebase Summary

Orientation for someone new to the repo. For the storage/queue design and the
manifest wire format, see [system-architecture.md](system-architecture.md).

## What it is

A CLI that uploads files to Telegram — either directly to a chat, or into a
channel used as a block store with automatic splitting, resume and integrity
verification.

Node/Bun, TypeScript, ESM throughout. ~5k lines of source.

## Commands

| Command | Alias | Purpose |
|---|---|---|
| `upload` | | send a file or directory straight to a chat |
| `upload-storage` | `store` | store a file in the storage channel (splits large files) |
| `download-storage` | `get` | restore a stored file by virtual path |
| `list-storage` | `ls` | list stored files, optionally by path prefix |
| `create` | | create a broadcast channel |
| `queue-status` | | show the upload queue |
| `queue-cancel` | | cancel a pending job |

## Layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | entry point; sets the process exit code, nothing else |
| `src/cli/` | argument parsing, dispatch, locking, command routing |
| `src/commands/` | one module per user-facing storage command |
| `src/queue/` | durable per-account job queue and its file locking |
| `src/storage/` | chunk split/merge, manifests, channel index, up/download |
| `src/uploader/` | media-specific paths: video metadata, image resize |
| `src/utils/` | validation, process lock, runtime paths, flood-wait retry, output |
| `tests/` | vitest suites; `tests/mocks/` holds the Telegram client double |

Files are kept under ~200 lines and named for what they do, so `Grep`/`Glob`
over filenames is a usable index.

## Conventions

- **Exit codes, not `process.exit`.** Handlers return a number; `src/index.ts`
  applies it. `process.exit` skips `finally` blocks and defeats cleanup.
- **Logs vs. output.** `logger` (winston) writes diagnostics, also to rotating
  files. `utils/console-output.ts` writes what the user reads. It is the only
  module allowed to touch `console` — enforced by eslint.
- **Config is read once, at import.** `config.ts` throws at import time when no
  account is configured, so low-level utilities must not import it; pass values
  in instead.
- **Type safety is a hard gate.** `src/` carries no `any` and no unsafe member
  access; the `no-unsafe-*` / `no-explicit-any` family is set to error, so the
  backlog cannot re-accumulate. Where a library has no usable type (gramjs
  returns broad unions and omits its EventEmitter surface), the boundary gets a
  narrow local interface and a checked cast — never a blanket `any`. Tests keep
  the looser rules so doubles can fake loosely-typed API shapes.
- **Error codes.** Node attaches string errno codes and Telegram numeric ones,
  neither on `Error`. `getErrorCode()` in `src/utils/errors.ts` is the single
  place that narrows this.

## Development

```bash
bun install
bun run dev            # bun --watch against src/
bun run type-check
bun run test           # vitest
bun run test:coverage
bun run lint
bun run build:ts       # emit dist/
bun run build-native   # single-file binaries for 4 targets
bun run build-docker   # container image (keeps sharp working)
```

CI runs type-check → test → compile → lint → audit, in that order: correctness
gates before style ones, so a style failure can never mask a broken build.

## Testing notes

- Each test file creates its own temp directory. Vitest runs files in parallel,
  and a shared tree means one file's cleanup can delete another's fixtures
  mid-run.
- `tests/mocks/telegram-client-mock.ts` mirrors Telegram's history semantics
  (newest first, `offsetId` exclusive, walking backwards). Keep it that way —
  a mock that returns everything at once hides pagination bugs.
- Queue tests point `HOME` at a temp directory, since the queue lives under
  `~/.tgmanager/`.

## Known gaps

- Channel index is O(history) per run; a pinned catalogue message would fix it.
- `src/cli/`, `src/commands/` and `src/uploader/` have no direct test coverage.
- Image resizing does not work in the single-file binaries (native module).
