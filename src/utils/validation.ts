import { resolve } from 'node:path';
import type { CommandOptions } from '../types/index.js';

/**
 * Validates and sanitizes file paths to prevent directory traversal attacks
 */
export function validatePath(filePath: string, baseDir: string): string {
  // Normalize the paths
  const normalizedBase = resolve(baseDir);
  const normalizedPath = resolve(baseDir, filePath);

  // Check if the resolved path is within the base directory
  if (!normalizedPath.startsWith(normalizedBase)) {
    throw new Error('Invalid path: Access denied outside base directory');
  }

  return normalizedPath;
}

/**
 * Validates chat ID format
 */
export function validateChatId(chatId: string): string {
  // Chat IDs can be:
  // - Numeric (including negative for channels/groups)
  // - Username (starting with @)
  // - "me" for self
  
  if (chatId === 'me') {
    return chatId;
  }

  if (chatId.startsWith('@')) {
    // Username validation: alphanumeric and underscores, 1-31 chars after @, must start with letter
    const usernameRegex = /^@[a-zA-Z][a-zA-Z0-9_]{0,30}$/;
    if (!usernameRegex.test(chatId)) {
      throw new Error('Invalid username format. Must be 1-31 characters, start with letter, alphanumeric and underscores only.');
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
 */
export function validateAccountName(accountName: string, availableAccounts: string[]): string {
  if (!accountName) {
    throw new Error('Account name is required');
  }

  // Prevent path traversal attacks
  if (accountName.includes('/') || accountName.includes('\\') || accountName.includes('..') || accountName.includes('\0')) {
    throw new Error('Invalid account name: contains illegal characters');
  }

  if (!availableAccounts.includes(accountName)) {
    throw new Error(`Invalid account name: ${accountName}. Available accounts: ${availableAccounts.join(', ')}`);
  }

  return accountName;
}

/** Canonical command names accepted by the CLI */
export const VALID_COMMANDS = ['upload', 'create', 'upload-storage', 'download-storage', 'list-storage', 'queue-status', 'queue-cancel'];

/** Short aliases for common storage commands */
const COMMAND_ALIASES: Record<string, string> = {
  store: 'upload-storage',
  get: 'download-storage',
  ls: 'list-storage',
};

/**
 * Resolve a command alias to its canonical name. Returns input unchanged if not an alias.
 */
export function resolveCommandAlias(cmd: string): string {
  return COMMAND_ALIASES[cmd] ?? cmd;
}

/**
 * Validates command arguments
 */
export function validateCommand(command: string | undefined, options: CommandOptions): CommandOptions {
  if (!command || !VALID_COMMANDS.includes(command)) {
    throw new Error(`Invalid command: ${command}. Valid commands: ${VALID_COMMANDS.join(', ')}`);
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

  if (command === 'upload-storage') {
    if (!options.filePath) {
      throw new Error('File path is required for upload-storage command');
    }
    if (!options.virtualPath) {
      throw new Error('Virtual path is required for upload-storage command');
    }
  }

  if (command === 'download-storage') {
    if (!options.virtualPath) {
      throw new Error('Virtual path is required for download-storage command');
    }
  }

  // list-storage requires no additional validation

  return options;
}

/**
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string;
export function sanitizeInput<T>(input: T): T;
export function sanitizeInput<T>(input: T): T {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove control characters and trim. The control-char class is the whole
  // point of this sanitizer, so the lint rule guarding against it is inverted here.
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim() as T;
}