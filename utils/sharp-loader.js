const logger = require('../logger');

let sharpInstance = null;
let sharpLoadAttempted = false;
let sharpAvailable = false;

/**
 * Attempts to load sharp with multiple fallback strategies
 */
async function loadSharp() {
  if (sharpLoadAttempted) {
    return sharpAvailable ? sharpInstance : null;
  }

  sharpLoadAttempted = true;

  // Strategy 1: Try dynamic import (works in most environments)
  try {
    const sharpModule = await import('sharp');
    // Handle different module export patterns
    let sharp = sharpModule.default || sharpModule;

    // If it's still not a function, try accessing the sharp property
    if (typeof sharp !== 'function' && sharp && sharp.sharp && typeof sharp.sharp === 'function') {
      sharp = sharp.sharp;
    }

    // Validate that we have a function
    if (typeof sharp !== 'function') {
      logger.debug('Sharp module loaded but not a function', {
        type: typeof sharp,
        keys: Object.keys(sharp || {})
      });
      throw new Error('Sharp is not a function');
    }

    sharpInstance = sharp;
    sharpAvailable = true;
    logger.debug('Sharp loaded successfully via dynamic import');
    return sharpInstance;
  } catch (error) {
    logger.debug('Failed to load sharp via dynamic import', { error: error.message });
  }

  // Strategy 2: Try require (fallback for CommonJS environments)
  try {
    let sharp = require('sharp');

    // Handle different module export patterns
    if (typeof sharp !== 'function' && sharp && sharp.default && typeof sharp.default === 'function') {
      sharp = sharp.default;
    }

    // If it's still not a function, try accessing the sharp property
    if (typeof sharp !== 'function' && sharp && sharp.sharp && typeof sharp.sharp === 'function') {
      sharp = sharp.sharp;
    }

    // Validate that we have a function
    if (typeof sharp !== 'function') {
      logger.debug('Sharp module loaded via require but not a function', {
        type: typeof sharp,
        keys: Object.keys(sharp || {})
      });
      throw new Error('Sharp is not a function');
    }

    sharpInstance = sharp;
    sharpAvailable = true;
    logger.debug('Sharp loaded successfully via require');
    return sharpInstance;
  } catch (error) {
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
      let sharp = require(path);

      // Handle different module export patterns
      if (typeof sharp !== 'function' && sharp && sharp.default && typeof sharp.default === 'function') {
        sharp = sharp.default;
      }

      // If it's still not a function, try accessing the sharp property
      if (typeof sharp !== 'function' && sharp && sharp.sharp && typeof sharp.sharp === 'function') {
        sharp = sharp.sharp;
      }

      // Validate that we have a function
      if (typeof sharp !== 'function') {
        logger.debug('Sharp module loaded from path but not a function', {
          path,
          type: typeof sharp,
          keys: Object.keys(sharp || {})
        });
        continue; // Try next path
      }

      sharpInstance = sharp;
      sharpAvailable = true;
      logger.debug('Sharp loaded successfully from path', { path });
      return sharpInstance;
    } catch (error) {
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
async function getSharp() {
  return await loadSharp();
}

/**
 * Checks if sharp is available
 */
function isSharpAvailable() {
  return sharpAvailable;
}

/**
 * Resets the sharp loading state (useful for testing)
 */
function resetSharpLoader() {
  sharpInstance = null;
  sharpLoadAttempted = false;
  sharpAvailable = false;
}

module.exports = {
  getSharp,
  isSharpAvailable,
  resetSharpLoader
};

