import { describe, it, expect } from 'vitest';
import { createProgressWriter } from '../../src/queue/queue-progress-writer.js';

/** Writer with a controllable clock, so throttling is tested without waiting. */
function makeWriter() {
  const writes: { jobId: string; percent: number }[] = [];
  let clock = 0;
  const writer = createProgressWriter(
    'acct',
    (_a, jobId, percent) => writes.push({ jobId, percent }),
    () => clock
  );
  return { writer, writes, tick: (ms: number) => { clock += ms; } };
}

describe('progress throttling', () => {
  it('discards ticks too small to be visible', () => {
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');

    tick(5000);
    writer.report(1);  // below the step
    expect(writes).toHaveLength(0);
  });

  it('writes once movement is worth showing', () => {
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');

    tick(5000);
    writer.report(10);

    expect(writes).toEqual([{ jobId: 'j1', percent: 10 }]);
  });

  it('does not write again immediately, however fast progress moves', () => {
    // A callback firing many times a second would otherwise put thousands of
    // updates on disk for a single file.
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');
    tick(5000);
    writer.report(10);

    for (let p = 12; p <= 40; p += 2) writer.report(p);

    expect(writes).toHaveLength(1);
  });

  it('writes again once the interval has passed', () => {
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');
    tick(5000);
    writer.report(10);

    tick(1500);
    writer.report(20);

    expect(writes).toHaveLength(2);
    expect(writes[1]!.percent).toBe(20);
  });

  it('always records completion, whatever the throttle says', () => {
    // The final write is the one that shows a file finishing.
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');
    tick(5000);
    writer.report(50);
    writer.report(100);

    expect(writes.at(-1)).toEqual({ jobId: 'j1', percent: 100 });
  });

  it('does not repeat an unchanged percentage', () => {
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');
    tick(5000);
    writer.report(100);
    writer.report(100);

    expect(writes).toHaveLength(1);
  });

  it('ignores progress before any job has started', () => {
    const { writer, writes, tick } = makeWriter();
    tick(5000);
    writer.report(50);

    expect(writes).toHaveLength(0);
  });

  it('attributes progress to the current job after a switch', () => {
    const { writer, writes, tick } = makeWriter();
    writer.startJob('j1');
    tick(5000);
    writer.report(80);

    writer.startJob('j2');
    tick(5000);
    writer.report(10);   // lower than j1's, but a different job

    expect(writes.at(-1)).toEqual({ jobId: 'j2', percent: 10 });
  });
});
