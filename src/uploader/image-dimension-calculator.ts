// Works out what size an image should be reduced to before upload.
//
// Kept separate from the upload path because it is pure arithmetic with several
// interacting constraints, and is far easier to verify directly than through a
// real resize.

/** The limits a target size has to satisfy. */
export interface DimensionLimits {
  /** Neither side may exceed this. */
  maxDimension: number;
  /** `width + height` may not exceed this. */
  maxCombinedDimensions: number;
  /** Longest side when an image must also be shrunk to fit the photo size limit. */
  photoMaxDimension: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Reduce `width`x`height` until it satisfies every applicable limit, preserving
 * the aspect ratio and never enlarging.
 *
 * @param fitPhotoLimit - also clamp the longest side to `photoMaxDimension`,
 *   which is how an image too many *bytes* to be a photo is brought under the
 *   limit. Dimension limits alone do not do this: an image can sit well inside
 *   them and still be far too large to send.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  limits: DimensionLimits,
  fitPhotoLimit: boolean
): Dimensions {
  const aspectRatio = width / height;

  // The combined budget is a sum, not an area: with width = ratio * height,
  // ratio * h + h = budget, so h = budget / (1 + ratio).
  let targetHeight = limits.maxCombinedDimensions / (1 + aspectRatio);
  let targetWidth = targetHeight * aspectRatio;

  // Then the per-axis cap, which may bind tighter than the combined one.
  if (targetWidth > limits.maxDimension) {
    targetWidth = limits.maxDimension;
    targetHeight = targetWidth / aspectRatio;
  }
  if (targetHeight > limits.maxDimension) {
    targetHeight = limits.maxDimension;
    targetWidth = targetHeight * aspectRatio;
  }

  if (fitPhotoLimit) {
    const longestSide = Math.max(targetWidth, targetHeight);
    if (longestSide > limits.photoMaxDimension) {
      const scale = limits.photoMaxDimension / longestSide;
      targetWidth *= scale;
      targetHeight *= scale;
    }
  }

  // An image already inside the limits would otherwise be scaled *up* to fill
  // the budget. Shrink only; scale both axes together so the ratio survives.
  const shrink = Math.min(1, width / targetWidth, height / targetHeight);
  targetWidth *= shrink;
  targetHeight *= shrink;

  return {
    width: Math.max(1, Math.floor(targetWidth)),
    height: Math.max(1, Math.floor(targetHeight)),
  };
}
