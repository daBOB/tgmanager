import { homedir } from 'os';
import { join } from 'path';
import type { Config, AccountConfig } from './types/index.js';
import { loadConfig } from './config-loader.js';
import { getConfigDirectory } from './utils/runtime-paths.js';
import { printError } from './utils/console-output.js';

// Load environment variables from appropriate location
loadConfig();

// Get base directory for relative paths
const configBaseDir = getConfigDirectory();

// Helper function to expand home directory
const expandPath = (filePath: string): string => {
  if (filePath.startsWith('~')) {
    return join(homedir(), filePath.slice(1));
  }
  // If relative path, make it relative to config base directory
  if (!filePath.startsWith('/')) {
    return join(configBaseDir, filePath);
  }
  return filePath;
};

// Helper function to get account config from environment
const getAccountConfig = (accountName: string): AccountConfig => {
  const prefix = accountName.toUpperCase();
  const apiId = process.env[`${prefix}_API_ID`];
  const apiHash = process.env[`${prefix}_API_HASH`];
  const phoneNumber = process.env[`${prefix}_PHONE`];
  const password = process.env[`${prefix}_PASSWORD`];

  if (!apiId || !apiHash || !phoneNumber) {
    throw new Error(`Missing configuration for account: ${accountName}. Please check your .env file.`);
  }

  // Validate apiId is a valid number
  const apiIdNum = parseInt(apiId, 10);
  if (isNaN(apiIdNum)) {
    throw new Error(`Invalid API ID for account ${accountName}: must be a number`);
  }

  return {
    apiId: apiIdNum,
    apiHash,
    phoneNumber,
    password: password || undefined
  };
};

// Build accounts object from environment
const buildAccounts = (): Record<string, AccountConfig> => {
  const accounts: Record<string, AccountConfig> = {};
  const accountNames = ['nitewalker', 'masterclass', 'junkies', 'nicenstein'];
  
  for (const name of accountNames) {
    try {
      accounts[name] = getAccountConfig(name);
    } catch (error) {
      // Account not configured, skip it
      printError(`Warning: ${(error as Error).message}`);
    }
  }

  if (Object.keys(accounts).length === 0) {
    throw new Error('No accounts configured. Please set up at least one account in your .env file.');
  }

  return accounts;
};

// Application configuration
const config: Config = {
  // Account configurations loaded from environment
  accounts: buildAccounts(),

  // Application settings
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    maxConcurrentUploads: (() => {
      const parsed = parseInt(process.env.MAX_CONCURRENT_UPLOADS || '1', 10);
      return isNaN(parsed) ? 1 : Math.max(1, parsed);
    })(),
    uploadTimeout: (() => {
      const parsed = parseInt(process.env.UPLOAD_TIMEOUT || '600000', 10);
      return isNaN(parsed) ? 600000 : parsed;
    })(),
    sessionDir: expandPath(process.env.SESSION_DIR || 'sessions'),
    uploadDir: expandPath(process.env.UPLOAD_DIR || 'uploads'),
  },

  // Telegram client settings
  telegram: {
    connectionRetries: 50,
    useWSS: true,
    floodWaitMultiplier: 1.5, // Multiplier for flood wait delays
  },

  // File processing settings
  fileProcessing: {
    image: {
      maxDimension: 5000,
      maxCombinedDimensions: 9000,
      supportedFormats: ['.jpg', '.jpeg', '.png', '.gif'],
    },
    video: {
      defaultWidth: 1920,
      defaultHeight: 1080,
      defaultDuration: 0,
    },
    premium: {
      maxFileSizeBytes: 4 * 1024 * 1024 * 1024, // 4 GB
    },
    regular: {
      maxFileSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    },
  },
};

export default config;