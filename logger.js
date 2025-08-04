const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
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
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // File transport for errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});

// Helper functions for common logging patterns
logger.logApiCall = (method, params = {}) => {
  // Sanitize sensitive data
  const sanitized = { ...params };
  if (sanitized.password) sanitized.password = '[REDACTED]';
  if (sanitized.phoneNumber) sanitized.phoneNumber = '[REDACTED]';
  if (sanitized.apiHash) sanitized.apiHash = '[REDACTED]';
  
  logger.debug('API call', { method, params: sanitized });
};

logger.logUpload = (fileName, chatId, size, duration) => {
  logger.info('File upload completed', {
    fileName,
    chatId,
    size: `${(size / 1024 / 1024).toFixed(2)} MB`,
    duration: `${duration}ms`,
  });
};

logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    ...context,
    stack: error.stack,
    code: error.code,
  });
};

module.exports = logger;