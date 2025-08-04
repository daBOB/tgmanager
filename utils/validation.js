const path = require('path');
const fs = require('fs');

/**
 * Validates and sanitizes file paths to prevent directory traversal attacks
 * @param {string} filePath - The file path to validate
 * @param {string} baseDir - The base directory to restrict access to
 * @returns {string} The validated and normalized path
 * @throws {Error} If the path is invalid or outside the base directory
 */
function validatePath(filePath, baseDir) {
  // Normalize the paths
  const normalizedBase = path.resolve(baseDir);
  const normalizedPath = path.resolve(baseDir, filePath);

  // Check if the resolved path is within the base directory
  if (!normalizedPath.startsWith(normalizedBase)) {
    throw new Error('Invalid path: Access denied outside base directory');
  }

  return normalizedPath;
}

/**
 * Validates chat ID format
 * @param {string} chatId - The chat ID to validate
 * @returns {string} The validated chat ID
 * @throws {Error} If the chat ID format is invalid
 */
function validateChatId(chatId) {
  // Chat IDs can be:
  // - Numeric (including negative for channels/groups)
  // - Username (starting with @)
  // - "me" for self
  
  if (chatId === 'me') {
    return chatId;
  }

  if (chatId.startsWith('@')) {
    // Username validation: alphanumeric and underscores, 5-32 chars
    const usernameRegex = /^@[a-zA-Z0-9_]{4,31}$/;
    if (!usernameRegex.test(chatId)) {
      throw new Error('Invalid username format. Must be 5-32 characters, alphanumeric and underscores only.');
    }
    return chatId;
  }

  // Numeric chat ID
  const numericId = parseInt(chatId, 10);
  if (isNaN(numericId)) {
    throw new Error('Invalid chat ID format. Must be numeric, username (@example), or "me".');
  }

  return chatId;
}

/**
 * Validates account name
 * @param {string} accountName - The account name to validate
 * @param {string[]} availableAccounts - List of available account names
 * @returns {string} The validated account name
 * @throws {Error} If the account name is invalid
 */
function validateAccountName(accountName, availableAccounts) {
  if (!accountName) {
    throw new Error('Account name is required');
  }

  if (!availableAccounts.includes(accountName)) {
    throw new Error(`Invalid account name: ${accountName}. Available accounts: ${availableAccounts.join(', ')}`);
  }

  return accountName;
}

/**
 * Validates file exists and is accessible
 * @param {string} filePath - The file path to check
 * @returns {fs.Stats} File statistics
 * @throws {Error} If file doesn't exist or is not accessible
 */
function validateFileExists(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied: ${filePath}`);
    }
    throw new Error(`Error accessing file: ${error.message}`);
  }
}

/**
 * Validates command arguments
 * @param {string} command - The command to validate
 * @param {object} options - The command options
 * @returns {object} Validated options
 * @throws {Error} If validation fails
 */
function validateCommand(command, options) {
  const validCommands = ['upload', 'create'];
  
  if (!validCommands.includes(command)) {
    throw new Error(`Invalid command: ${command}. Valid commands: ${validCommands.join(', ')}`);
  }

  if (command === 'upload') {
    if (!options.chatId) {
      throw new Error('Chat ID is required for upload command');
    }
    if (!options.filePath) {
      throw new Error('File path is required for upload command');
    }
  }

  if (command === 'create') {
    if (!options.name) {
      throw new Error('Name is required for create command');
    }
    // Validate channel name
    if (options.name.length < 1 || options.name.length > 255) {
      throw new Error('Channel name must be between 1 and 255 characters');
    }
  }

  return options;
}

/**
 * Sanitizes user input to prevent injection attacks
 * @param {string} input - The input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove control characters and trim
  return input
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim();
}

module.exports = {
  validatePath,
  validateChatId,
  validateAccountName,
  validateFileExists,
  validateCommand,
  sanitizeInput,
};