// Regression tests for the storage channel index.
//
// The finder originally read a single 100-message page, so any file whose
// manifest had been pushed out of that window by later uploads became invisible
// to path lookup, hash dedup and list-storage — silently, with no error.
// Chunk uploads share the channel with manifests, so the window fills fast.
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTelegramClient } from '../mocks/telegram-client-mock.js';
import { StorageService } from '../../src/storage/storage-service.js';
import { StorageIndex } from '../../src/storage/storage-file-finder.js';
import { makeManifest } from '../helpers/test-fixtures.js';

/** Fill the channel with non-manifest traffic, as chunk uploads do. */
async function pushChunkMessages(client: MockTelegramClient, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await client.sendMessage('-100123456789', { message: `#chunk filler ${i}` });
  }
}

describe('storage channel pagination', () => {
  let client: MockTelegramClient;
  let storage: StorageService;

  beforeEach(async () => {
    client = new MockTelegramClient();
    storage = new StorageService(client as any);
    await storage.initializeStorageChannel();
  });

  it('finds a manifest buried far beyond the first page of history', async () => {
    const buried = makeManifest({ fileId: 'buried', originalName: 'buried.bin' });
    await storage.uploadManifest(buried);

    // Bury it under several pages of chunk messages
    await pushChunkMessages(client, 250);

    // A fresh service must not benefit from the writer's warm cache
    const reader = new StorageService(client as any);
    await reader.initializeStorageChannel();

    const found = await reader.findByPath('Archive/buried.bin');
    expect(found).not.toBeNull();
    expect(found?.fileId).toBe('buried');
  });

  it('dedups by hash against a file older than one page', async () => {
    await storage.uploadManifest(makeManifest({ fileId: 'old', originalName: 'old.bin' }));
    await pushChunkMessages(client, 150);

    const reader = new StorageService(client as any);
    await reader.initializeStorageChannel();

    expect(await reader.findByHash('hash-old')).not.toBeNull();
    expect(await reader.findByHash('hash-absent')).toBeNull();
  });

  it('lists every manifest across multiple pages', async () => {
    for (let i = 0; i < 12; i++) {
      await storage.uploadManifest(makeManifest({ fileId: `f${i}`, originalName: `f${i}.bin` }));
      await pushChunkMessages(client, 20);
    }

    const reader = new StorageService(client as any);
    await reader.initializeStorageChannel();

    const all = await reader.listStoredFiles();
    expect(all).toHaveLength(12);
    expect(new Set(all.map(f => f.fileId)).size).toBe(12);
  });

  it('terminates on an empty channel', async () => {
    expect(await storage.listStoredFiles()).toEqual([]);
  });
});

describe('StorageIndex caching', () => {
  it('walks the channel once and serves later lookups from cache', async () => {
    const client = new MockTelegramClient();
    const storage = new StorageService(client as any);
    await storage.initializeStorageChannel();
    await storage.uploadManifest(makeManifest({ fileId: 'a', originalName: 'a.bin' }));
    await pushChunkMessages(client, 120);

    let historyReads = 0;
    const counting = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === 'getMessages') {
          return async (chatId: string, options: any) => {
            if (!options.ids) historyReads++;
            return (target as any).getMessages(chatId, options);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const index = new StorageIndex(counting as any, '-100123456789');
    await index.findByHash('hash-a');
    const readsAfterFirst = historyReads;

    await index.findByPath('Archive/a.bin');
    await index.listByPath('Archive');

    expect(readsAfterFirst).toBeGreaterThan(1); // paged through history
    expect(historyReads).toBe(readsAfterFirst); // later lookups hit the cache
  });

  it('re-walks after invalidation', async () => {
    const client = new MockTelegramClient();
    const index = new StorageIndex(client as any, '-100123456789');

    await client.sendMessage('-100123456789', {
      message: `#manifest fileId:x\n\n${JSON.stringify(makeManifest({ fileId: 'x', originalName: 'x.bin' }))}`,
    });

    expect(await index.findByPath('Archive/x.bin')).not.toBeNull();

    index.invalidate();
    expect(await index.findByPath('Archive/x.bin')).not.toBeNull();
  });
});
