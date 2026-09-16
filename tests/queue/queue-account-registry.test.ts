import { describe, it, expect, beforeEach } from 'vitest';
import { useTempQueueHome } from '../helpers/test-fixtures.js';
import {
  registerKnownAccounts,
  assertKnownAccount,
  resetKnownAccounts,
} from '../../src/queue/queue-account-registry.js';

beforeEach(() => {
  resetKnownAccounts();
});

describe('assertKnownAccount', () => {
  // The defect this guards: a throwaway script that imports the queue directly
  // resolves to the real ~/.tgmanager/queue.db and never passes through the CLI,
  // so nothing validated its account name. Twelve fixture rows for a
  // non-existent 'demo' account sat in the production queue for four days.
  it('refuses to write when no accounts have been registered', () => {
    expect(() => assertKnownAccount('demo')).toThrow(/no accounts registered/i);
  });

  it('accepts an account the CLI registered', () => {
    registerKnownAccounts(['nitewalker', 'junkies']);

    expect(() => assertKnownAccount('nitewalker')).not.toThrow();
  });

  it('rejects an account that is not configured', () => {
    registerKnownAccounts(['nitewalker', 'junkies']);

    expect(() => assertKnownAccount('demo')).toThrow(/demo/);
  });

  // Without the list the operator cannot tell a typo from a missing config.
  it('names the configured accounts when rejecting', () => {
    registerKnownAccounts(['nitewalker', 'junkies']);

    expect(() => assertKnownAccount('demo')).toThrow(/nitewalker, junkies/);
  });

  it('is case-sensitive, matching how accounts are configured', () => {
    registerKnownAccounts(['nitewalker']);

    expect(() => assertKnownAccount('NiteWalker')).toThrow();
  });

  // Registering an empty config must not silently unlock every account.
  it('still refuses when the registered list is empty', () => {
    registerKnownAccounts([]);

    expect(() => assertKnownAccount('demo')).toThrow(/no accounts registered/i);
  });

  it('forgets registrations on reset, so one run cannot authorise the next', () => {
    registerKnownAccounts(['nitewalker']);
    resetKnownAccounts();

    expect(() => assertKnownAccount('nitewalker')).toThrow(/no accounts registered/i);
  });
});

// The guard is only worth anything at the point that writes rows, so exercise
// it through the real enqueue path against a real (temporary) database.
describe('addJobs enforcement', () => {
  useTempQueueHome('queue-guard');

  const options = { filePath: '/tmp/example.bin', virtualPath: 'Archive/example.bin' } as never;

  it('refuses to enqueue for an account no one registered', async () => {
    const { addJobs } = await import('../../src/queue/queue-manager.js');

    expect(() => addJobs('demo', [options])).toThrow(/no accounts registered/i);
  });

  it('refuses to enqueue for an account outside the registered set', async () => {
    registerKnownAccounts(['nitewalker']);
    const { addJobs } = await import('../../src/queue/queue-manager.js');

    expect(() => addJobs('demo', [options])).toThrow(/unknown account/i);
  });

  it('enqueues normally for a registered account', async () => {
    registerKnownAccounts(['nitewalker']);
    const { addJobs, listJobs } = await import('../../src/queue/queue-manager.js');

    addJobs('nitewalker', [options]);

    expect(listJobs('nitewalker', {})).toHaveLength(1);
  });

  // A refused write must leave nothing behind, not a partial batch.
  it('writes no rows at all when the account is refused', async () => {
    registerKnownAccounts(['nitewalker']);
    const { addJobs, listJobs } = await import('../../src/queue/queue-manager.js');

    expect(() => addJobs('demo', [options, options, options])).toThrow();
    expect(listJobs('demo', {})).toHaveLength(0);
  });
});
