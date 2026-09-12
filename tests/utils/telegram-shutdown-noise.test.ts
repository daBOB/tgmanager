import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginTelegramShutdown,
  isExpectedShutdownRejection,
  resetShutdownStateForTests,
} from '../../src/utils/telegram-shutdown-noise.js';

beforeEach(() => resetShutdownStateForTests());

describe('gramjs shutdown noise', () => {
  it('ignores the TIMEOUT rejection once teardown has started', () => {
    beginTelegramShutdown();

    expect(isExpectedShutdownRejection(new Error('TIMEOUT'))).toBe(true);
  });

  it('does not ignore a TIMEOUT during an upload', () => {
    // Mid-transfer this is a real failure and must still surface.
    expect(isExpectedShutdownRejection(new Error('TIMEOUT'))).toBe(false);
  });

  it('does not ignore other rejections during teardown', () => {
    beginTelegramShutdown();

    expect(isExpectedShutdownRejection(new Error('AUTH_KEY_DUPLICATED'))).toBe(false);
    expect(isExpectedShutdownRejection('TIMEOUT')).toBe(false);
    expect(isExpectedShutdownRejection(undefined)).toBe(false);
  });
});
