# File-Based Upload Queue Patterns Research Report

**Date:** 2026-02-06
**Context:** CLI tool (Bun/TypeScript) uploading large files (up to 27GB) to Telegram in chunks
**Requirement:** Cross-process queue coordination, one upload at a time

---

## 1. File-Based Locking Patterns

### PID Files (NOT Recommended)
- **Mechanism:** Write process ID to file, check before starting
- **Critical Issue:** Race conditions when deleting PID files
- **Best Practice:** Never delete PID files - just terminate process and leave file
- **Stale Detection:** Check if PID in file is still running before blocking
- **Reference:** [Never Delete PID Files!](https://www.guido-flohr.net/never-delete-your-pid-file/)

### flock-Based Locking (Recommended)
- **Mechanism:** Atomic file locking using flock(1) system call
- **Advantages:**
  - No race conditions
  - Automatic cleanup on process termination
  - Kernel-enforced exclusivity
- **Stale Detection:** Locks automatically released when process dies
- **Fallback Paths:** `/run/lock` → `/var/lock` → `/tmp/locks`
- **Reference:** [locks: Robust file-based locking utility](https://github.com/Open-Technology-Foundation/locks)

### Lockfile Libraries (Node.js/Bun)
- **proper-lockfile:** Popular npm package, cross-platform, stale lock detection
- **lockfile:** Simpler alternative, less feature-rich
- **Use Case:** Wrap queue access in lock acquire/release pattern

---

## 2. Simple Queue Implementations

### JSON File Queue
**Pattern:**
```
queue.json: { jobs: [{ id, file, status, created, started }] }
```

**Operations:**
- Lock file → Read JSON → Modify → Write JSON → Unlock
- **Pros:** Simple, human-readable, no dependencies
- **Cons:** File rewrite on every operation, no concurrent readers
- **Best For:** Low-frequency queues (<10 jobs/min)

### Maildir-Style Queue (Recommended for CLI)
**Pattern:**
```
queue/
  tmp/    - Jobs being written
  new/    - Jobs ready to process
  cur/    - Jobs being processed
```

**Operations:**
- Write to tmp/ → Atomic rename to new/
- Worker moves new/ → cur/ → process → delete
- **Pros:** No database, atomic operations, crash-safe
- **Cons:** Filesystem overhead for many small files
- **Reference:** [agent-message-queue](https://github.com/avivsinai/agent-message-queue) - designed for CLI tools like Claude Code

### SQLite Queue (Recommended for Production)
**Libraries:**
- `node-persistent-queue` - FIFO, crash recovery, Node.js setImmediate
- `node-sqlite-queue` - Retry logic, delays, exponential backoff
- `better-queue-sqlite` - SQLite backend for better-queue framework

**Schema Pattern:**
```sql
CREATE TABLE queue (
  id INTEGER PRIMARY KEY,
  file TEXT,
  status TEXT,  -- pending, processing, complete, failed
  created_at INTEGER,
  started_at INTEGER,
  attempts INTEGER
);
```

**Operations:**
- BEGIN TRANSACTION → SELECT + UPDATE status → COMMIT
- **Pros:** ACID guarantees, queryable, handles large queues efficiently
- **Cons:** Dependency on SQLite, slightly more complex
- **Best For:** Production CLI tools, >100 jobs, retry logic needed
- **References:**
  - [node-persistent-queue](https://github.com/damoclark/node-persistent-queue)
  - [node-sqlite-queue](https://github.com/sinkhaha/node-sqlite-queue)

---

## 3. Queue Persistence Across Restarts

### Critical Requirements
1. **Atomic Writes:** Never leave queue in inconsistent state
2. **Recovery:** Detect interrupted jobs on restart
3. **Status Tracking:** Distinguish pending vs processing vs failed

### Recovery Strategies

**SQLite Approach:**
```typescript
// On startup
await db.exec(`
  UPDATE queue
  SET status = 'pending', started_at = NULL
  WHERE status = 'processing'
`);
```

**Maildir Approach:**
- Jobs in cur/ without worker PID → move back to new/
- Jobs in tmp/ older than 5min → delete (incomplete write)

**JSON Approach:**
- Check lock file on startup, if stale → clear it
- Reset all "processing" jobs to "pending"

### Process Crash Handling
- **flock:** Automatically released by kernel
- **PID files:** Require stale check + manual cleanup
- **SQLite:** Transaction rollback prevents corruption
- **Maildir:** Atomic renames prevent partial state

---

## 4. CLI Upload Queue Best Practices

### UX Pattern: Add-to-Queue vs Wait

**Background Queue (Recommended):**
```
$ tgmanager upload large-file.mp4
✓ Added to upload queue (position: 3)
Run 'tgmanager queue status' to monitor progress
```

**Advantages:**
- Instant response (<100ms)
- User can close terminal, process continues
- No blocking on long operations
- Better for scripting/automation
- **Reference:** [Background jobs guidance - Azure](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs)

**Wait Pattern (Alternative):**
```
$ tgmanager upload large-file.mp4 --wait
⏳ Waiting in queue (position: 3)...
⏳ Upload started...
[=====>    ] 45% (5.2GB / 11.6GB)
```

**Use When:**
- User explicitly wants to see progress
- Scripting requires knowing when upload completes
- Small files that finish quickly

### Queue Management Commands
```bash
tgmanager queue add <file>        # Add without waiting
tgmanager queue status            # Show queue + active jobs
tgmanager queue cancel <job-id>   # Remove from queue
tgmanager queue clear             # Clear pending jobs
tgmanager upload <file> --wait    # Add + wait for completion
```

### Worker Architecture Options

**Option A: Daemon Process**
- Background worker always running
- Watches queue directory/database
- **Pros:** Instant processing, no startup overhead
- **Cons:** Another process to manage, daemon lifecycle

**Option B: Poll-and-Process**
- Each CLI invocation checks if worker needed
- If queue has work + no worker → become worker
- **Pros:** No daemon, simpler deployment
- **Cons:** Slight delay before processing starts

**Option C (Recommended): Hybrid**
- CLI checks for worker process
- If absent + queue not empty → spawn detached worker
- Worker exits when queue empty
```typescript
if (!isWorkerRunning() && hasQueuedJobs()) {
  spawn('tgmanager', ['worker'], { detached: true, stdio: 'ignore' });
}
```

---

## Recommended Implementation

**For Your Use Case (Bun/TypeScript, Large Files):**

1. **Queue Storage:** SQLite (node-sqlite-queue or custom)
   - Handle 27GB files gracefully
   - Track progress, retries, failures
   - Query queue status easily

2. **Locking:** flock-based (proper-lockfile npm package)
   - Prevent multiple workers
   - Auto-cleanup on crash

3. **Architecture:** Hybrid worker spawn
   - `upload` command adds to queue + spawns worker if needed
   - Worker processes queue serially until empty
   - Worker writes PID to lock file while running

4. **UX:** Background by default, --wait flag optional
   - Fast CLI response time
   - Progress monitoring via separate command

---

## Unresolved Questions

1. Should partially uploaded files (crashed mid-upload) be resumed or restarted?
2. Priority system needed (urgent files skip queue)?
3. Network failure retry strategy - exponential backoff or fixed delay?
4. Maximum queue size / disk space limits?
