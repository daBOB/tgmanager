const path = require('path');
const os = require('os');

// Load environment variables
require('dotenv').config();

// Helper function to expand home directory
const expandPath = (filePath) => {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
};

// Helper function to get account config from environment
const getAccountConfig = (accountName) => {
  const prefix = accountName.toUpperCase();
  const apiId = process.env[`${prefix}_API_ID`];
  const apiHash = process.env[`${prefix}_API_HASH`];
  const phoneNumber = process.env[`${prefix}_PHONE`];
  const password = process.env[`${prefix}_PASSWORD`];

  if (!apiId || !apiHash || !phoneNumber) {
    throw new Error(`Missing configuration for account: ${accountName}. Please check your .env file.`);
  }

  return {
    apiId: parseInt(apiId, 10),
    apiHash,
    phoneNumber,
    password: password || undefined
  };
};

// Build accounts object from environment
const buildAccounts = () => {
  const accounts = {};
  const accountNames = ['nitewalker', 'masterclass', 'junkies', 'nicenstein'];
  
  for (const name of accountNames) {
    try {
      accounts[name] = getAccountConfig(name);
    } catch (error) {
      // Account not configured, skip it
      console.warn(`Warning: ${error.message}`);
    }
  }

  if (Object.keys(accounts).length === 0) {
    throw new Error('No accounts configured. Please set up at least one account in your .env file.');
  }

  return accounts;
};

// Application configuration
const config = {
  // Account configurations loaded from environment
  accounts: buildAccounts(),

  // Application settings
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    maxConcurrentUploads: parseInt(process.env.MAX_CONCURRENT_UPLOADS, 10) || 1,
    uploadTimeout: parseInt(process.env.UPLOAD_TIMEOUT, 10) || 600000,
    sessionDir: expandPath(process.env.SESSION_DIR || '~/.tgmanager/sessions'),
    uploadDir: expandPath(process.env.UPLOAD_DIR || '~/.tgmanager/uploads'),
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

module.exports = config;