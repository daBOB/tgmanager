import winston from 'winston';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure logs directory exists
let logsDir: string;
try {
  logsDir = process.pkg
    ? join(process.cwd(), 'logs') // For packaged app, use current working directory
    : join(dirname(__dirname), 'logs'); // For development, use project directory
} catch {
  // CWD may not exist (e.g., deleted directory with packaged executable)
  // Fallback to project directory
  logsDir = join(dirname(__dirname), 'logs');
}

// Only create directory if not in pkg snapshot
if (!process.pkg && !existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
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
    if (stack) {
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
    // File transport for all logs
    new winston.transports.File({
      filename: join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // File transport for errors only
    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});

// Helper functions for common logging patterns
interface SanitizedParams {
  [key: string]: unknown;
  password?: string;
  phoneNumber?: string;
  apiHash?: string;
}

export const logApiCall = (method: string, params: Record<string, unknown> = {}): void => {
  // Sanitize sensitive data
  const sanitized: SanitizedParams = { ...params };
  if (sanitized.password) sanitized.password = '[REDACTED]';
  if (sanitized.phoneNumber) sanitized.phoneNumber = '[REDACTED]';
  if (sanitized.apiHash) sanitized.apiHash = '[REDACTED]';
  
  logger.debug('API call', { method, params: sanitized });
};

export const logUpload = (fileName: string, chatId: string, size: number, duration: number): void => {
  logger.info('File upload completed', {
    fileName,
    chatId,
    size: `${(size / 1024 / 1024).toFixed(2)} MB`,
    duration: `${duration}ms`,
  });
};

export const logError = (error: Error, context: Record<string, unknown> = {}): void => {
  logger.error(error.message, {
    ...context,
    stack: error.stack,
    code: (error as any).code,
  });
};

export default logger;