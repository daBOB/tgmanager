// Duplicate detection for plain `upload`: identity is the file's bytes, not its
// name. Batches routinely share a naming scheme across unrelated albums, so a
// name-based check would both miss real duplicates and falsely match distinct
// files.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir, useRegisteredAccounts } from '../helpers/test-fixtures.js';

useRegisteredAccounts('testaccount', 'dedup-other');

let tempHome: string;
let workDir: string;
const realHome = process.env.HOME;

beforeEach(() => {
  tempHome = makeTempDir('dedup-home');
  workDir = makeTempDir('dedup-work');
  process.env.HOME = tempHome;
});

afterEach(async () => {
  const { closeDb, getQueueDbPath } = await import('../../src/queue/queue-database.js');
  closeDb(getQueueDbPath());
  process.env.HOME = realHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

const ACCOUNT = 'testaccount';
const CHAT = '-1001234567890';

function writeFile(name: string, contents: string): string {
  const path = join(workDir, name);
  writeFileSync(path, contents);
  return path;
}

/** Enqueue and immediately complete a job, as a finished upload would leave it. */
async function markUploaded(filePath: string): Promise<void> {
  const { addJob, completeJob } = await import('../../src/queue/queue-manager.js');
  const { hashFile } = await import('../../src/storage/checksum-utils.js');
  const { hash } = await hashFile(filePath);
  const job = addJob(ACCOUNT, {
    kind: 'channel', filePath, chatId: CHAT, contentHash: hash,
  } as never);
  completeJob(ACCOUNT, job.id);
}

async function enqueue(path: string, options: Record<string, unknown> = {}) {
  const { handleUploadChannelQueue } = await import('../../src/cli/upload-channel-queue-handler.js');
  const { addJobs } = await import('../../src/queue/queue-manager.js');
  return handleUploadChannelQueue(ACCOUNT, path, { chatId: CHAT, ...options }, addJobs);
}

describe('duplicate detection by content', () => {
  it('skips a file whose bytes already reached this chat', async () => {
    const original = writeFile('original.jpg', 'identical bytes');
    await markUploaded(original);

    const outcome = await enqueue(original);

    expect(outcome.kind).toBe('done');
  });

  it('catches the same bytes under a different name', async () => {
    const first = writeFile('album-a-001.jpg', 'identical bytes');
    await markUploaded(first);

    const renamed = writeFile('completely-different-name.jpg', 'identical bytes');
    const outcome = await enqueue(renamed);

    expect(outcome.kind).toBe('done');
  });

  it('does not skip different bytes sharing a name across directories', async () => {
    // The real case: two albums both using a bot's naming scheme.
    const albumA = writeFile('(More at @BOT)__1.jpg', 'album A content');
    await markUploaded(albumA);

    const otherDir = makeTempDir('dedup-other');
    const albumB = join(otherDir, '(More at @BOT)__1.jpg');
    writeFileSync(albumB, 'album B content');

    const outcome = await enqueue(albumB);

    expect(outcome.kind).toBe('queued');
    rmSync(otherDir, { recursive: true, force: true });
  });

  it('only counts uploads that actually completed', async () => {
    const { addJob, failJob } = await import('../../src/queue/queue-manager.js');
    const { hashFile } = await import('../../src/storage/checksum-utils.js');
    const path = writeFile('failed-before.jpg', 'some bytes');
    const { hash } = await hashFile(path);

    const job = addJob(ACCOUNT, {
      kind: 'channel', filePath: path, chatId: CHAT, contentHash: hash,
    } as never);
    failJob(ACCOUNT, job.id, 'RPC_CALL_FAIL');

    // A failed upload put nothing in the channel, so it must not block a retry.
    const outcome = await enqueue(path);
    expect(outcome.kind).toBe('queued');
  });

  it('scopes duplicates to the chat they were uploaded to', async () => {
    const path = writeFile('shared.jpg', 'same bytes');
    await markUploaded(path);

    const outcome = await enqueue(path, { chatId: '-1009999999999' });

    expect(outcome.kind).toBe('queued');
  });

  it('re-uploads regardless when --force is given', async () => {
    const path = writeFile('forced.jpg', 'same bytes');
    await markUploaded(path);

    const outcome = await enqueue(path, { force: true });

    expect(outcome.kind).toBe('queued');
  });

  it('queues only the new files from a partly-uploaded directory', async () => {
    const already = writeFile('one.jpg', 'first');
    writeFile('two.jpg', 'second');
    writeFile('three.jpg', 'third');
    await markUploaded(already);

    const outcome = await enqueue(workDir);

    expect(outcome.kind).toBe('queued');
    if (outcome.kind === 'queued') expect(outcome.jobIds).toHaveLength(2);
  });

  it('records the hash so a later run can match against it', async () => {
    const path = writeFile('records.jpg', 'bytes');

    await enqueue(path);

    const { listJobs } = await import('../../src/queue/queue-manager.js');
    expect(listJobs(ACCOUNT)[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
