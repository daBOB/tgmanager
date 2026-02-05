import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import logger from './logger.js';

// Determine if running as compiled executable
const isExecutable = process.pkg !== undefined;

// Get appropriate base directory
const getBaseDirectory = (): string => {
  if (isExecutable) {
    // For executables, use the directory containing the executable
    return dirname(process.execPath);
  } else {
    // For source code, use project root
    // Handle both ESM and CJS
    if (typeof __dirname !== 'undefined') {
      // CommonJS
      return dirname(__dirname);
    } else {
      // ES modules
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      return dirname(__dirname);
    }
  }
};

// Load environment configuration
export const loadConfig = (): void => {
  const baseDir = getBaseDirectory();
  
  // Define possible .env file locations in order of preference
  const possibleEnvPaths = [
    // 1. Command-line specified path
    process.env.TGMANAGER_CONFIG,
    // 2. Current working directory (may fail if CWD doesn't exist)
    (() => { try { return join(process.cwd(), '.env'); } catch { return ''; } })(),
    // 3. Next to the executable/project root
    join(baseDir, '.env'),
    // 4. User's home config directory
    join(homedir(), '.tgmanager', '.env'),
    // 5. System-wide config
    '/etc/tgmanager/.env',
  ].filter(Boolean) as string[];

  // Try to load from each location
  let loaded = false;
  for (const envPath of possibleEnvPaths) {
    if (existsSync(envPath)) {
      try {
        dotenvConfig({ path: envPath });
        logger.info(`Configuration loaded from: ${envPath}`);
        loaded = true;
        break;
      } catch (error) {
        logger.warn(`Failed to load config from ${envPath}:`, { error: (error as Error).message });
      }
    }
  }

  if (!loaded) {
    // Check if any required environment variables are already set
    const hasSystemEnv = process.env.NITEWALKER_API_ID || 
                        process.env.MASTERCLASS_API_ID || 
                        process.env.JUNKIES_API_ID || 
                        process.env.NICENSTEIN_API_ID;
    
    if (hasSystemEnv) {
      logger.info('Using system environment variables');
    } else {
      logger.warn('No .env file found. Checked locations:', { paths: possibleEnvPaths });
      logger.info('You can:');
      logger.info('1. Create a .env file in one of these locations');
      logger.info('2. Set TGMANAGER_CONFIG=/path/to/.env');
      logger.info('3. Set account credentials as environment variables');
    }
  }
};

// Helper to get config directory for sessions and uploads
export const getConfigDirectory = (): string => {
  // Check for user-specified config directory
  if (process.env.TGMANAGER_HOME) {
    return process.env.TGMANAGER_HOME;
  }
  
  if (isExecutable) {
    // For executables, use home directory by default
    return join(homedir(), '.tgmanager');
  } else {
    // For development, use project directory
    // Handle both ESM and CJS
    if (typeof __dirname !== 'undefined') {
      // CommonJS
      return dirname(__dirname);
    } else {
      // ES modules
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      return dirname(__dirname);
    }
  }
};

// Export helpers
export { isExecutable, getBaseDirectory };