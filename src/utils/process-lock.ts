import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';
import { isProcessAlive } from './process-liveness.js';

/**
 * Process lock to prevent multiple instances from running with the same account
 */
export class ProcessLock {
  private lockFile: string;
  private locked: boolean = false;
  private cleanupRegistered: boolean = false;

  constructor(lockDir: string, accountName: string) {
    // Ensure lock directory exists
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true });
    }
    
    this.lockFile = join(lockDir, `${accountName}.lock`);
  }

  /**
   * Acquire the lock
   * @param force - Force acquire even if another process has the lock
   * @returns true if lock was acquired, false otherwise
   */
  acquire(force: boolean = false): boolean {
    try {
      // Check if lock file exists
      if (existsSync(this.lockFile)) {
        const lockContent = readFileSync(this.lockFile, 'utf-8').trim();
        const lockPid = parseInt(lockContent, 10);

        if (!force && isProcessAlive(lockPid)) {
          logger.error('Another instance is already running', { 
            pid: lockPid,
            lockFile: this.lockFile 
          });
          return false;
        } else {
          logger.warn('Removing stale lock file', { 
            pid: lockPid,
            lockFile: this.lockFile 
          });
          this.release();
        }
      }

      // Create lock file with current PID
      writeFileSync(this.lockFile, process.pid.toString(), 'utf-8');
      this.locked = true;
      logger.debug('Lock acquired', { pid: process.pid, lockFile: this.lockFile });
      return true;
    } catch (error) {
      logger.error('Failed to acquire lock', { 
        error: (error as Error).message,
        lockFile: this.lockFile 
      });
      return false;
    }
  }

  /**
   * Release the lock
   */
  release(): void {
    if (!this.locked) {
      return;
    }

    try {
      if (existsSync(this.lockFile)) {
        unlinkSync(this.lockFile);
        logger.debug('Lock released', { pid: process.pid, lockFile: this.lockFile });
      }
      this.locked = false;
    } catch (error) {
      logger.error('Failed to release lock', { 
        error: (error as Error).message,
        lockFile: this.lockFile 
      });
    }
  }

  /**
   * Setup cleanup handlers
   */
  setupCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    // Cleanup on normal exit
    process.on('exit', () => {
      this.release();
    });

    // Cleanup on SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, cleaning up...');
      this.release();
      process.exit(130);
    });

    // Cleanup on SIGTERM
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, cleaning up...');
      this.release();
      process.exit(143);
    });

    // Cleanup on uncaught exception
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.release();
      process.exit(1);
    });

    // Cleanup on unhandled rejection
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      this.release();
      process.exit(1);
    });
  }
}

/**
 * Create a process lock for an account
 */
export function createProcessLock(lockDir: string, accountName: string): ProcessLock {
  return new ProcessLock(lockDir, accountName);
}
