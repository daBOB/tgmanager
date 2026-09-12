# Sharp and image resizing

`sharp` is a native module: it ships a platform-specific `.node` binding rather
than plain JavaScript. That makes it the one dependency whose availability
depends on *how* TGManager was built and where it runs.

Image resizing is treated as optional throughout. When the binding cannot be
loaded, uploads continue as ordinary document uploads instead of failing.

## Where resizing works

| Distribution | Resizing | Why |
|---|---|---|
| `bun run src/index.ts` (source) | ✅ | Real `node_modules`, binding resolves for the host platform |
| Docker image (`bun run build-docker`) | ✅ | The image installs dependencies for its own platform |
| Standalone binary (`bun run build-native`) | ❌ | `bun build --compile` cannot embed a native `.node` binding |

If you need resizing on a machine without a toolchain, use the Docker image
rather than the single-file binary.

## How the fallback works

`src/utils/sharp-loader.ts` owns the entire decision:

- The import is attempted lazily, on first use, not at startup — so a missing
  binding never delays or breaks CLI commands that touch no images.
- The result is cached after the first attempt, **including failure**, so a
  broken install costs one failed import per run rather than one per file.
- `getSharp()` resolves to `null` when the module is unavailable. Every caller
  is typed against that and falls back to a document upload.

The consequence: a missing `sharp` produces one `warn` line
(`Sharp unavailable — image resizing disabled for this run`) and otherwise
degrades silently. Uploads still succeed; the images just are not resized to
Telegram's dimension limits first.

## Diagnosing a failed load

Run with debug logging and look for the loader's own lines:

```bash
LOG_LEVEL=debug bun run src/index.ts -a myaccount -c upload -i @channel -f image.jpg
```

- `Sharp loaded` — the binding resolved; resizing is active.
- `Sharp unavailable — image resizing disabled for this run` — the attached
  `error` field carries the underlying import failure.

Common causes, in order of likelihood:

1. **Running a standalone binary.** Expected, not a bug — see the table above.
2. **Platform binding not installed.** The `@img/sharp-*` packages are
   `optionalDependencies`; an install that skipped optional deps
   (`--no-optional`, or a locked-down CI) leaves no binding. Reinstall with
   optional dependencies enabled.
3. **Architecture mismatch.** A `node_modules` tree copied between platforms
   (for example, an x64 tree mounted into an arm64 container) carries the wrong
   binding. Install inside the target platform instead of copying.
