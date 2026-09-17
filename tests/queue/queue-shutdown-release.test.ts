// A worker that is asked to stop hands its claimed job back.
//
// Signals arrive while an upload is in flight, and the transfer dies with the
// process either way. What matters is that the row does not stay in
// `processing` behind a pid that no longer exists, which is what made every
// interrupted run open with a warning about work nobody was doing.
import { describe, it, expect } from 'vitest';
import { releaseInFlightJobOnShutdown } from '../../src/queue/queue-shutdown-release.js';
import { useRegisteredAccounts, useTempQueueHome } from '../helpers/test-fixtures.js';

useRegisteredAccounts('testaccount');
useTempQueueHome('shutdown-release');

const ACCOUNT = 'testaccount';
const queue = () => import('../../src/queue/queue-manager.js');

/**
 * Invoke what the signal would, without raising it.
 *
 * Emitting SIGTERM for real would reach the test runner's own handlers too, so
 * the listener is called directly — and taking it from the front of the list
 * is itself the assertion that it was prepended.
 */
function fireShutdownHandler(): void {
  const handlers = process.listeners('SIGTERM');
  handlers[0]?.('SIGTERM');
}

async function claimOne(): Promise<string> {
  const { addJob, claimJob } = await queue();
  const job = addJob(ACCOUNT, { filePath: '/tmp/clip.mp4', virtualPath: 'V/clip.mp4' });
  claimJob(ACCOUNT, job.id);
  return job.id;
}

describe('releaseInFlightJobOnShutdown', () => {
  it('returns the claimed job to pending', async () => {
    const jobId = await claimOne();
    const stop = releaseInFlightJobOnShutdown(ACCOUNT, { jobId });

    fireShutdownHandler();
    stop();

    const { getJob } = await queue();
    const job = getJob(ACCOUNT, jobId);
    expect(job?.status).toBe('pending');
    expect(job?.workerPid).toBeNull();
  });

  it('runs before the handlers already registered, which exit the process', async () => {
    const alreadyListening = (): void => undefined;
    process.on('SIGTERM', alreadyListening);

    const stop = releaseInFlightJobOnShutdown(ACCOUNT, { jobId: null });
    expect(process.listeners('SIGTERM')[0]).not.toBe(alreadyListening);

    stop();
    process.removeListener('SIGTERM', alreadyListening);
  });

  it('leaves a job that finished before the signal arrived alone', async () => {
    const jobId = await claimOne();
    const { completeJob, getJob } = await queue();
    completeJob(ACCOUNT, jobId);

    const stop = releaseInFlightJobOnShutdown(ACCOUNT, { jobId });
    fireShutdownHandler();
    stop();

    expect(getJob(ACCOUNT, jobId)?.status).toBe('completed');
  });

  it('stops listening once the worker is done', async () => {
    const before = process.listeners('SIGTERM').length;

    const stop = releaseInFlightJobOnShutdown(ACCOUNT, { jobId: null });
    stop();

    expect(process.listeners('SIGTERM')).toHaveLength(before);
  });
});
