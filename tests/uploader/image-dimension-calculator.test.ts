import { describe, it, expect } from 'vitest';
import { computeTargetDimensions } from '../../src/uploader/image-dimension-calculator.js';
import type { DimensionLimits } from '../../src/uploader/image-dimension-calculator.js';

const LIMITS: DimensionLimits = {
  maxDimension: 5000,
  maxCombinedDimensions: 9000,
  photoMaxDimension: 2560,
};

/** Aspect ratio survives resizing, within a pixel of rounding. */
function expectRatioPreserved(from: { width: number; height: number }, to: { width: number; height: number }): void {
  expect(to.width / to.height).toBeCloseTo(from.width / from.height, 1);
}

describe('computeTargetDimensions', () => {
  describe('combined-dimension limit', () => {
    it('treats the combined limit as a sum of the sides, not an area', () => {
      // The previous implementation used sqrt(maxCombined * ratio), which reads
      // the budget as an area and collapsed this to 82x109.
      const result = computeTargetDimensions(6000, 8000, LIMITS, false);

      expect(result.width + result.height).toBeLessThanOrEqual(LIMITS.maxCombinedDimensions);
      expect(result.width).toBeGreaterThan(3000);
      expectRatioPreserved({ width: 6000, height: 8000 }, result);
    });

    it('uses the full budget rather than undershooting it', () => {
      const result = computeTargetDimensions(10000, 10000, LIMITS, false);

      // Square image: the per-axis cap binds first at 5000, but 5000+5000
      // exceeds the 9000 budget, so 4500x4500 is the answer.
      expect(result).toEqual({ width: 4500, height: 4500 });
    });
  });

  describe('per-axis limit', () => {
    it('caps a very wide image at maxDimension on its long side', () => {
      const result = computeTargetDimensions(20000, 2000, LIMITS, false);

      expect(result.width).toBeLessThanOrEqual(LIMITS.maxDimension);
      expect(result.height).toBeLessThanOrEqual(LIMITS.maxDimension);
      expect(result.width + result.height).toBeLessThanOrEqual(LIMITS.maxCombinedDimensions);
    });
  });

  describe('never enlarging', () => {
    it('leaves an image already inside every limit alone', () => {
      const result = computeTargetDimensions(800, 600, LIMITS, false);

      expect(result).toEqual({ width: 800, height: 600 });
    });

    it('does not upscale a small image asked to fit the photo limit', () => {
      const result = computeTargetDimensions(100, 80, LIMITS, true);

      expect(result).toEqual({ width: 100, height: 80 });
    });
  });

  describe('photo size limit', () => {
    it('clamps the longest side to photoMaxDimension', () => {
      // The real failure: inside every dimension limit, far too many bytes.
      const result = computeTargetDimensions(2160, 2880, LIMITS, true);

      expect(Math.max(result.width, result.height)).toBe(LIMITS.photoMaxDimension);
      expectRatioPreserved({ width: 2160, height: 2880 }, result);
    });

    it('applies to the larger of the two failing shapes as well', () => {
      const result = computeTargetDimensions(3072, 4096, LIMITS, true);

      expect(Math.max(result.width, result.height)).toBe(LIMITS.photoMaxDimension);
      expectRatioPreserved({ width: 3072, height: 4096 }, result);
    });

    it('does not clamp when the photo limit is not being targeted', () => {
      const result = computeTargetDimensions(2160, 2880, LIMITS, false);

      expect(Math.max(result.width, result.height)).toBeGreaterThan(LIMITS.photoMaxDimension);
    });
  });

  describe('degenerate inputs', () => {
    it('never returns a zero dimension for an extreme aspect ratio', () => {
      const result = computeTargetDimensions(20000, 1, LIMITS, true);

      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });
});
