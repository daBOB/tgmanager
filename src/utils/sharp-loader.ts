// Lazily loads the optional native `sharp` dependency.
//
// Image resizing is a nice-to-have: if the native binding is missing for the
// running platform (or stripped from a compiled single-file binary), the CLI
// must still upload files. Callers therefore always handle a `null` result.
// The load is attempted once and the outcome cached, including failure.
import type { Sharp } from 'sharp';
import logger from '../logger.js';

/** The `sharp()` entry point: takes an image path or buffer, returns a pipeline. */
export type SharpFactory = (input?: string | Buffer) => Sharp;

let cached: SharpFactory | null = null;
let attempted = false;

/** Returns the sharp factory, or null when the native module is unavailable. */
export async function getSharp(): Promise<SharpFactory | null> {
  if (attempted) return cached;
  attempted = true;

  try {
    const sharpModule = await import('sharp');
    cached = (sharpModule.default ?? sharpModule);
    logger.debug('Sharp loaded');
  } catch (error) {
    logger.warn('Sharp unavailable — image resizing disabled for this run', {
      error: (error as Error).message,
    });
    cached = null;
  }

  return cached;
}
