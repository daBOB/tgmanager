import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import logger from './logger.js';
import { getBaseDirectory } from './utils/runtime-paths.js';

// Load environment configuration
export const loadConfig = (): void => {
  const baseDir = getBaseDirectory();
  
  // Define possible .env file locations in order of preference
  const possibleEnvPaths = [
    // 1. Command-line specified path
    process.env.TGMANAGER_CONFIG,
    // 2. Current working directory (may fail if CWD doesn't exist)
    ((): string => { try { return join(process.cwd(), '.env'); } catch { return ''; } })(),
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
        // quiet: dotenv v17 otherwise prints a promo banner to stdout on every
        // load, which corrupts piped CLI output. Load results are logged below.
        dotenvConfig({ path: envPath, quiet: true });
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
