import logger from '../logger.js';

/**
 * Custom error classes for better error handling
 */

export class TelegramUploadError extends Error {
  code: string;
  details: Record<string, unknown>;
  timestamp: Date;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TelegramUploadError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

export class ValidationError extends Error {
  field: string;
  value: unknown;
  timestamp: Date;

  constructor(message: string, field: string, value: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.timestamp = new Date();
  }
}

export class ConfigurationError extends Error {
  missingConfig: string;
  timestamp: Date;

  constructor(message: string, missingConfig: string) {
    super(message);
    this.name = 'ConfigurationError';
    this.missingConfig = missingConfig;
    this.timestamp = new Date();
  }
}

export class FileProcessingError extends Error {
  filePath: string;
  operation: string;
  timestamp: Date;

  constructor(message: string, filePath: string, operation: string) {
    super(message);
    this.name = 'FileProcessingError';
    this.filePath = filePath;
    this.operation = operation;
    this.timestamp = new Date();
  }
}

export class FloodWaitError extends Error {
  seconds: number;
  code: number;
  timestamp: Date;

  constructor(seconds: number, message = 'Too many requests') {
    super(message);
    this.name = 'FloodWaitError';
    this.seconds = seconds;
    this.code = 420;
    this.timestamp = new Date();
  }
}

export class AuthKeyDuplicatedError extends Error {
  code: number;
  timestamp: Date;

  constructor(message = 'Authentication key is being used from another location') {
    super(message);
    this.name = 'AuthKeyDuplicatedError';
    this.code = 406;
    this.timestamp = new Date();
  }
}

interface ErrorContext {
  [key: string]: unknown;
}

/**
 * Error handler middleware for consistent error handling
 */
export function handleError(error: Error, context: ErrorContext = {}): string {
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
  } else if (error instanceof AuthKeyDuplicatedError) {
    logger.error('Authentication key duplicated', {
      errorType: error.name,
      code: error.code,
      message: 'The same session is being used from multiple locations',
      ...context
    });
  } else {
    logger.error(error.message, {
      errorType: error.name || 'UnknownError',
      stack: error.stack,
      code: (error as any).code,
      ...(error instanceof TelegramUploadError ? error.details : {}),
      ...context
    });
  }
  
  // Return user-friendly error message
  return getUserFriendlyMessage(error);
}

/**
 * Convert errors to user-friendly messages
 */
export function getUserFriendlyMessage(error: Error): string {
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

  if (error instanceof AuthKeyDuplicatedError) {
    return `Authentication error: The same session is being used from another location. Please:\n` +
           `1. Stop all other running instances\n` +
           `2. Wait a few minutes\n` +
           `3. Try again\n` +
           `If the problem persists, clear your session: rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT/*`;
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