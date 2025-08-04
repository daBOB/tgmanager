/**
 * Custom error classes for better error handling
 */

class TelegramUploadError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'TelegramUploadError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

class ValidationError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.timestamp = new Date();
  }
}

class ConfigurationError extends Error {
  constructor(message, missingConfig) {
    super(message);
    this.name = 'ConfigurationError';
    this.missingConfig = missingConfig;
    this.timestamp = new Date();
  }
}

class FileProcessingError extends Error {
  constructor(message, filePath, operation) {
    super(message);
    this.name = 'FileProcessingError';
    this.filePath = filePath;
    this.operation = operation;
    this.timestamp = new Date();
  }
}

class FloodWaitError extends Error {
  constructor(seconds, message = 'Too many requests') {
    super(message);
    this.name = 'FloodWaitError';
    this.seconds = seconds;
    this.code = 420;
    this.timestamp = new Date();
  }
}

/**
 * Error handler middleware for consistent error handling
 */
function handleError(error, context = {}) {
  const logger = require('../logger');
  
  // Log error with appropriate level
  if (error instanceof ValidationError || error instanceof ConfigurationError) {
    logger.warn(error.message, {
      errorType: error.name,
      ...error,
      ...context
    });
  } else if (error instanceof FloodWaitError) {
    logger.info('Rate limited by Telegram', {
      waitSeconds: error.seconds,
      ...context
    });
  } else {
    logger.error(error.message, {
      errorType: error.name || 'UnknownError',
      stack: error.stack,
      code: error.code,
      ...error.details,
      ...context
    });
  }
  
  // Return user-friendly error message
  return getUserFriendlyMessage(error);
}

/**
 * Convert errors to user-friendly messages
 */
function getUserFriendlyMessage(error) {
  if (error instanceof ValidationError) {
    return `Invalid input: ${error.message}`;
  }
  
  if (error instanceof ConfigurationError) {
    return `Configuration error: ${error.message}. Please check your .env file.`;
  }
  
  if (error instanceof FileProcessingError) {
    return `File processing error: ${error.message}`;
  }
  
  if (error instanceof FloodWaitError) {
    return `Rate limited. Please wait ${error.seconds} seconds before trying again.`;
  }
  
  if (error instanceof TelegramUploadError) {
    switch (error.code) {
      case 'FILE_TOO_LARGE':
        return 'File is too large for upload. Check your account limits.';
      case 'INVALID_FILE_TYPE':
        return 'This file type is not supported.';
      case 'NETWORK_ERROR':
        return 'Network error. Please check your connection and try again.';
      default:
        return `Upload failed: ${error.message}`;
    }
  }
  
  // Generic error
  return 'An unexpected error occurred. Please try again.';
}

module.exports = {
  TelegramUploadError,
  ValidationError,
  ConfigurationError,
  FileProcessingError,
  FloodWaitError,
  handleError,
  getUserFriendlyMessage
};