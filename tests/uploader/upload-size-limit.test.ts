import { describe, it, expect } from 'vitest';
import {
  TRANSPORT_MAX_UPLOAD_BYTES,
  maxUploadBytes,
  checkUploadSize,
} from '../../src/uploader/upload-size-limit.js';

/** Sizes taken from the real queue history, so the boundary is not theoretical. */
const LARGEST_OBSERVED_SUCCESS = 4_077_912_064; // 7778 parts — uploaded fine
const OBSERVED_FILE_PARTS_INVALID = 4_224_063_572; // 8057 parts — rejected by Telegram
const POLICY_PREMIUM = 4 * 1024 ** 3;
const POLICY_REGULAR = 2 * 1024 ** 3;

describe('maxUploadBytes', () => {
  // The defect: config allowed 4 GiB, but 4 GiB needs 8192 parts and Telegram
  // accepts 8000. Files in the gap uploaded for hours, then failed with
  // FILE_PARTS_INVALID at the very end.
  it('caps a premium account at what the transport can actually carry', () => {
    expect(maxUploadBytes(true)).toBe(TRANSPORT_MAX_UPLOAD_BYTES);
    expect(maxUploadBytes(true)).toBeLessThan(POLICY_PREMIUM);
  });

  // A regular account's 2 GiB policy limit is stricter than the transport
  // ceiling, so that is what must bind.
  it('leaves a regular account on its stricter policy limit', () => {
    expect(maxUploadBytes(false)).toBe(POLICY_REGULAR);
  });

  it('never exceeds either the policy or the transport limit', () => {
    expect(maxUploadBytes(true)).toBeLessThanOrEqual(POLICY_PREMIUM);
    expect(maxUploadBytes(false)).toBeLessThanOrEqual(POLICY_REGULAR);
  });
});

describe('checkUploadSize', () => {
  it('accepts the largest file that really did upload', () => {
    expect(checkUploadSize(LARGEST_OBSERVED_SUCCESS, true).ok).toBe(true);
  });

  // The exact file that burned hours before failing at the API.
  it('rejects the file that Telegram answered with FILE_PARTS_INVALID', () => {
    expect(checkUploadSize(OBSERVED_FILE_PARTS_INVALID, true).ok).toBe(false);
  });

  it('accepts a file exactly at the ceiling', () => {
    expect(checkUploadSize(TRANSPORT_MAX_UPLOAD_BYTES, true).ok).toBe(true);
  });

  it('rejects a file one byte over the ceiling', () => {
    expect(checkUploadSize(TRANSPORT_MAX_UPLOAD_BYTES + 1, true).ok).toBe(false);
  });

  it('rejects an empty file', () => {
    const result = checkUploadSize(0, true);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/empty/i);
  });

  it('applies the stricter limit to a regular account', () => {
    const threeGB = 3 * 1024 ** 3;

    expect(checkUploadSize(threeGB, true).ok).toBe(true);
    expect(checkUploadSize(threeGB, false).ok).toBe(false);
  });

  // The whole point of the change: the queue records why, not just that.
  it('explains the rejection with both the file size and the limit', () => {
    const result = checkUploadSize(OBSERVED_FILE_PARTS_INVALID, true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/3\.9\d GB/);
    expect(result.reason).toMatch(/limit/i);
  });

  it('says which account type the limit came from', () => {
    const over = checkUploadSize(3 * 1024 ** 3, false);

    expect(over.ok === false && over.reason).toMatch(/regular/i);
  });
});
