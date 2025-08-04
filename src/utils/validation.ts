import { resolve } from 'path';
import { statSync } from 'fs';
import type { Stats } from 'fs';
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
 */
export function validateAccountName(accountName: string, availableAccounts: string[]): string {
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
 */
export function validateFileExists(filePath: string): Stats {
  try {
    const stats = statSync(filePath);
    return stats;
  } catch (error: any) {
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
 */
export function validateCommand(command: string | undefined, options: CommandOptions): CommandOptions {
  const validCommands = ['upload', 'create'];
  
  if (!command || !validCommands.includes(command)) {
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
 */
export function sanitizeInput(input: string): string;
export function sanitizeInput<T>(input: T): T;
export function sanitizeInput<T>(input: T): T {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove control characters and trim
  return input
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim() as T;
}