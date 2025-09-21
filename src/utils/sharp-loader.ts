import logger from '../logger.js';

let sharpInstance: any = null;
let sharpLoadAttempted = false;
let sharpAvailable = false;

/**
 * Attempts to load sharp with multiple fallback strategies
 */
async function loadSharp(): Promise<any> {
  if (sharpLoadAttempted) {
    return sharpAvailable ? sharpInstance : null;
  }

  sharpLoadAttempted = true;

  // Strategy 1: Try dynamic import (works in most environments)
  try {
    const sharpModule = await import('sharp');
    sharpInstance = sharpModule.default || sharpModule;
    sharpAvailable = true;
    logger.debug('Sharp loaded successfully via dynamic import');
    return sharpInstance;
  } catch (error: any) {
    logger.debug('Failed to load sharp via dynamic import', { error: error.message });
  }

  // Strategy 2: Try require (fallback for CommonJS environments)
  try {
    sharpInstance = require('sharp');
    sharpAvailable = true;
    logger.debug('Sharp loaded successfully via require');
    return sharpInstance;
  } catch (error: any) {
    logger.debug('Failed to load sharp via require', { error: error.message });
  }

  // Strategy 3: Try loading from different paths (for pkg environments)
  const possiblePaths = [
    'sharp',
    './node_modules/sharp',
    '../node_modules/sharp',
    '../../node_modules/sharp',
  ];

  for (const path of possiblePaths) {
    try {
      sharpInstance = require(path);
      sharpAvailable = true;
      logger.debug('Sharp loaded successfully from path', { path });
      return sharpInstance;
    } catch (error: any) {
      logger.debug('Failed to load sharp from path', { path, error: error.message });
    }
  }

  logger.warn('Sharp could not be loaded. Image processing will be disabled.');
  sharpAvailable = false;
  return null;
}

/**
 * Gets the sharp instance, loading it if necessary
 */
export async function getSharp(): Promise<any> {
  return await loadSharp();
}

/**
 * Checks if sharp is available
 */
export function isSharpAvailable(): boolean {
  return sharpAvailable;
}

/**
 * Resets the sharp loading state (useful for testing)
 */
export function resetSharpLoader(): void {
  sharpInstance = null;
  sharpLoadAttempted = false;
  sharpAvailable = false;
}
