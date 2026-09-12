import winston from 'winston';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { getWritableDataDir } from './utils/runtime-paths.js';

const logsDir = join(getWritableDataDir(), 'logs');

// Best-effort: a read-only or unwritable location must not stop the CLI from
// running, so file logging is dropped rather than crashing at import time.
let fileLoggingAvailable = true;
try {
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
} catch {
  fileLoggingAvailable = false;
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Custom format for file output (no colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    if (typeof stack === 'string') {
      msg += `\n${stack}`;
    }
    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // File transports, only when the log directory could actually be created
    ...(fileLoggingAvailable
      ? [
          // All logs
          new winston.transports.File({
            filename: join(logsDir, 'app.log'),
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
          }),
          // Errors only
          new winston.transports.File({
            filename: join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
          }),
        ]
      : []),
  ],
  exitOnError: false,
});

// Structured helper for the one event worth reporting uniformly
export const logUpload = (fileName: string, chatId: string, size: number, duration: number): void => {
  logger.info('File upload completed', {
    fileName,
    chatId,
    size: `${(size / 1024 / 1024).toFixed(2)} MB`,
    duration: `${duration}ms`,
  });
};

export default logger;