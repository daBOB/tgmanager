# File Splitting & Merging Strategies Research

## Executive Summary
File splitting breaks large files into manageable chunks for upload/storage reliability. Key strategy: use streams for memory efficiency, manifests for reconstruction tracking, and checksums for integrity verification.

---

## 1. FILE SPLITTING ALGORITHMS

### Chunk Size Selection
- **5-50MB chunks**: Industry standard (50MB common in multipart uploads)
- **500MB chunks**: Enterprise backup scenarios (fs.createReadStream start/end options)
- **Trade-off**: Smaller chunks = more requests/overhead; larger chunks = more memory/failure cost

### Naming Conventions (Sequential)
```
file.bin.001, file.bin.002, ...   // Simple sequential
file-chunk-0, file-chunk-1, ...   // JSON-friendly naming
[uuid]-part-1, [uuid]-part-2, ... // Globally unique identification
```

### Implementation: Node.js Streams
- **fs.createReadStream()**: Configurable highWaterMark (default 64KB)
- **Custom chunking**: Explicit start/end positions for predictable chunk sizes
- **Parallel chunk writing**: Independent WriteStreams for concurrent I/O
- **Memory model**: Only current chunk in RAM, rest on disk

---

## 2. INTEGRITY VERIFICATION

### Checksum Strategies (Trade-off Matrix)

| Algorithm | Speed | Security | Use Case |
|-----------|-------|----------|----------|
| **SHA-256** | Slow | Cryptographic ✓ | Security-critical, blockchain |
| **SHA-1** | Medium | Deprecated ⚠️ | Legacy compatibility only |
| **MD5** | Fast | Non-cryptographic | Quick integrity checks |
| **CRC-32** | Fastest | Non-cryptographic | Real-time streaming verification |
| **Adler-32** | Very Fast | Weak | Speed priority scenarios |

### Implementation Pattern
```javascript
// Per-chunk checksums (fast verification)
chunks: [
  { index: 0, hash: "sha256:abc123...", size: 5242880 },
  { index: 1, hash: "sha256:def456...", size: 5242880 }
]

// Full-file checksum (final validation)
originalHash: "sha256:xyz789..."
```

**Best practice**: Combine per-chunk (fast) + file-level (comprehensive) checksums.

---

## 3. METADATA & MANIFEST FILES

### Manifest Structure (JSON)
```json
{
  "fileId": "uuid",
  "originalName": "document.pdf",
  "originalSize": 104857600,
  "chunkSize": 5242880,
  "totalChunks": 20,
  "originalHash": "sha256:...",
  "createdAt": "2025-02-02T15:00:00Z",
  "chunks": [
    {
      "index": 0,
      "filename": "doc-chunk-0",
      "size": 5242880,
      "hash": "sha256:...",
      "uploadedAt": "2025-02-02T15:05:00Z"
    }
  ],
  "status": "in_progress|complete"
}
```

### Storage Strategy
- **Same location as chunks**: Versioned .manifest files for atomic reconstruction
- **Separate metadata store**: Database table for query-friendly access
- **Recovery**: Manifest essential if any chunk lost; validate chunk hashes on reconstruction

---

## 4. NODE.JS STREAMS FOR LARGE FILES

### Memory-Efficient Architecture
```javascript
// Readable → Transform → Writable pipeline
fs.createReadStream(input, { highWaterMark: 5*1024*1024 })
  .pipe(new ChunkTransform(chunkSize))
  .pipe(fs.createWriteStream(output))
```

### Key Benefits
- **Constant memory**: Process 10GB file with <50MB RAM
- **Backpressure handling**: Streams pause/resume automatically
- **Pipeline error propagation**: Unified error handling
- **Non-blocking I/O**: Server processes other requests during read

### Stream Configuration
- **highWaterMark**: Buffer size before pause signal (default 64KB)
- **Tuning**: highWaterMark = chunkSize for optimal throughput
- **Backpressure**: Always handle 'drain' event in writable streams

---

## 5. EXISTING TOOLS & LIBRARIES

### OS-Level Tools
- **split command** (Linux/macOS): `split -b 50m file.tar.gz output-`
- **7-Zip**: Builtin split with compression + integrity
- **tar with split**: `tar cf - file | split -b 500m -`

### Node.js Libraries
- **fs.createReadStream/WriteStream**: Built-in, recommended for fine-grained control
- **archiver**: Zip creation with streaming, no split support
- **tar**: Create .tar.gz; manual split required
- **multipart-upload patterns**: AWS S3, Google Cloud Storage built-in

### Cloud-Native Approach
- **AWS S3 Multipart Upload**: Handles 5MB-5GB parts, parallel upload
- **Resume capability**: Each part tracked separately; restart from failure point
- **Built-in integrity**: ETag checksums per part

---

## 6. RECOMMENDED STRATEGY FOR TELEGRAM BOT

### Architecture Decision
1. **Chunk size**: 5MB (Telegram API file limit ~20MB, safety margin for headers)
2. **Checksum**: SHA-256 per-chunk + file-level verification
3. **Manifest**: Lightweight JSON in separate file/database
4. **Streaming**: fs.createReadStream with Transform for chunking
5. **Concurrency**: 3-5 parallel chunk uploads (Telegram rate limits)

### Reconstruction Algorithm
1. **Validate manifest integrity** (fileId, totalChunks match)
2. **Verify all chunk hashes** sequentially (memory-efficient)
3. **Stream chunks to fs.createWriteStream** in order
4. **Final hash validation** against original
5. **Delete chunks on success**

### Error Recovery
- **Missing chunk**: Detect via manifest; retry download
- **Hash mismatch**: Re-download single chunk; update manifest
- **Partial upload**: Resume from last successful chunk index

---

## IMPLEMENTATION SUMMARY

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Splitting | fs.createReadStream + Transform | Memory-efficient, built-in |
| Chunk size | 5MB | Telegram limits, reliability |
| Checksums | SHA-256 (per-chunk + file) | Security + performance balance |
| Metadata | JSON manifest + DB | Query-friendly recovery |
| Streams | Node.js Transform | Non-blocking, backpressure handling |
| Concurrency | 3-5 parallel | Rate limit compliance |
| Recovery | Manifest-based retry | Resilient to partial failures |

---

## SOURCES
- [CodeSignal] File Checksum Verification (checksum algorithms)
- [GeeksforGeeks] Data Integrity & Checksum Methods (algorithm comparison)
- [DEV Community] Node.js Streams for Efficient Data Handling
- [DigitalOcean] Working with Files Using Streams in Node.js
- [Medium] Chunking in Node.js File Streams (practical patterns)
- [Stack Overflow] File splitting techniques (split, 7-zip approaches)
- [Node.js Documentation] Stream API & fs module
