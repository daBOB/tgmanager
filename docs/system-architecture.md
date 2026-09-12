# System Architecture

How tgmanager stores files in a Telegram channel, and the invariants that keep
stored data retrievable. The manifest format below is a **wire format** — it is
written into Telegram messages and read back by later versions of the tool, so
changes to it are breaking changes.

## Components

```
src/
├── index.ts                 CLI entry; the only place the process sets an exit code
├── cli/
│   ├── cli-parser.ts        commander setup, alias resolution
│   ├── command-dispatcher.ts  cwd guard, validation, account lock, delegation
│   ├── command-router.ts    routes an authenticated command to its handler
│   ├── upload-directory-command.ts  `upload` (direct-to-chat)
│   └── upload-storage-queue-handler.ts  pre-lock enqueue + duplicate pre-check
├── queue/                   durable job queue (JSON file per account)
├── storage/                 chunking, manifests, channel index
├── uploader/                media-specific upload paths (video, image resize)
└── utils/                   validation, locks, paths, flood-wait retry, output
```

Handlers return exit codes rather than calling `process.exit`, so cleanup in
`finally` blocks actually runs — `process.exit` skips them.

## Storage model

A Telegram channel is used as a block store. Two kinds of message live in it:

| Message | Marker | Contents |
|---|---|---|
| Chunk | `#chunk` caption | one slice of file bytes, as an attachment |
| Manifest | `#manifest` caption | JSON describing a file and where its chunks are |

There is no server-side index. **Chunks and manifests share one channel**, so
history grows much faster than the file count.

### Manifest format (version 1)

```jsonc
{
  "fileId":       "uuid",        // identity of this stored file
  "version":      1,             // bump only for incompatible changes
  "originalName": "movie.mkv",   // filename
  "originalPath": "Video/VR",    // virtual DIRECTORY, no trailing filename
  "originalSize": 8589934592,    // bytes
  "originalHash": "sha256-hex",  // whole-file digest; drives dedup
  "chunkSize":    3972844748,
  "totalChunks":  3,
  "chunks": [
    {
      "index":      0,
      "filename":   "movie.mkv.part000",
      "size":       3972844748,
      "hash":       "sha256-hex",  // per-chunk digest, verified on download
      "messageId":  1234,          // where the bytes landed
      "uploadedAt": "ISO-8601",
      "uploaded":   true           // resume flag
    }
  ],
  "status":    "splitting | uploading | complete | failed",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

**The virtual path is derived, not stored.** Lookups join `originalPath` and
`originalName` (`Video/VR` + `movie.mkv` → `Video/VR/movie.mkv`). Anything
reading manifests must apply the same join or paths will not match.

A manifest is sent as message text when under Telegram's 4096-character limit,
otherwise as a JSON file attachment. Readers must handle both. Do not wrap the
JSON in a code fence: Telegram strips backtick formatting from message text,
which breaks extraction on the way back.

### Channel index

`storage-file-finder.ts` reconstructs the index by walking channel history and
parsing every `#manifest` message.

- The walk **must paginate** (`offsetId`, backwards, until exhausted). Reading a
  single page silently hides every older file from path lookup, hash dedup and
  `list-storage` — with no error. One large split upload can push older manifests
  out of a single page on its own.
- `MAX_MESSAGES_SCANNED` bounds worst-case API usage, not the result set.
- `StorageIndex` caches one walk per instance. A batch upload calls `findByHash`
  once per file; without the cache each call re-reads the whole channel.
  `uploadManifest` appends to the cache; `deleteStoredFile` invalidates it.

This is O(channel history) per run. A pinned catalogue message would make it
O(1), at the cost of a second source of truth to keep consistent.

## Splitting

`DEFAULT_CHUNK_SIZE` is ~3.7 GB: Telegram rejects uploads near the 4 GB API
limit even for premium accounts, so the threshold is universal and the premium
flag is not consulted. Chunking streams through an fd-based read loop, computing
per-chunk and whole-file SHA-256 in one pass.

Download reverses this: fetch each chunk by `messageId`, verify its hash, then
merge in `index` order and verify the whole-file hash.

## Upload queue

Uploads go through a per-account JSON queue at `~/.tgmanager/queue/<account>.queue.json`.

Job states: `pending → processing → completed | failed | cancelled`.

Two processes write this file by design: the CLI enqueues jobs **before**
acquiring the account lock, precisely because a worker may already hold it.
Therefore:

- Writes are atomic (temp file + `rename`).
- Every read-modify-write cycle holds an `O_EXCL` lockfile for the whole cycle
  (`queue-file-lock.ts`). Locking only the write is not sufficient — interleaved
  cycles lose updates, silently dropping a queued job or overwriting a claim.
- A lock whose owner PID is dead, or which is older than 30s, is broken
  automatically so a crash cannot wedge the queue.
- Jobs left `processing` by a dead worker are returned to `pending` on the next
  worker start.

## Locks and paths

| Concern | Mechanism |
|---|---|
| One instance per account | PID lockfile under `locks/`, released on exit and signals |
| Queue mutation | `O_EXCL` lockfile per account queue file |
| Where config is read | `.env` via `TGMANAGER_CONFIG`, cwd, install dir, `~/.tgmanager`, `/etc/tgmanager` |
| Where logs are written | project root from source; cwd (falling back to `~/.tgmanager`) from a binary |

`runtime-paths.ts` is the single place that decides these. Running from a
compiled binary is detected by the module living under Bun's virtual `/$bunfs/`
root, which is **not writable** — writing next to the module crashes there.

## Rate limiting

All Telegram calls that can hit flood waits go through
`utils/flood-wait-retry.ts`: error 420, wait the server's seconds times a safety
multiplier, up to 10 attempts. It covers chunk upload, message fetch and media
download. Downloads matter as much as uploads — a restore runs long enough that
a flood wait part-way through is likely.

## Distribution

| Artifact | Built by | sharp / image resize |
|---|---|---|
| Source / `bun run dev` | — | works |
| Docker image | `bun run build-docker` | works (real `node_modules`) |
| Single-file binaries | `bun run build-native` | **unavailable** |

`bun build --compile` cannot embed native `.node` addons, so sharp does not load
inside the standalone binaries. `sharp-loader.ts` degrades gracefully: images
upload unresized. Telegram rejects images past its dimension limits, so oversized
images will fail to upload from a binary. Use the Docker image or run from source
when resizing matters.
