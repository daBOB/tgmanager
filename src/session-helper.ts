import { StringSession, StoreSession } from 'telegram/sessions/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import type { Session } from 'telegram/sessions/Abstract.js';
import logger from './logger.js';
import { isCompiledBinary } from './utils/runtime-paths.js';

/**
 * Creates a session that works in both development and packaged environments
 */
export function createSession(sessionDir: string): Session {
  // A compiled binary has no writable module directory for StoreSession's
  // backing store, so persist the session string to a file we control instead.
  if (isCompiledBinary) {
    const sessionFile = join(sessionDir, 'session.txt');
    
    // Ensure directory exists
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    
    // Load existing session if available
    let sessionString = '';
    if (existsSync(sessionFile)) {
      sessionString = readFileSync(sessionFile, 'utf-8').trim();
    }
    
    const session = new StringSession(sessionString);
    
    // Override save method to persist to file
    const originalSave = session.save.bind(session);
    session.save = function() {
      const result = originalSave();
      writeFileSync(sessionFile, result, 'utf-8');
      // Best-effort: session file is still usable if the mode can't be tightened
      // (e.g. exFAT/NTFS mounts), but the weaker permissions are worth recording.
      try {
        chmodSync(sessionFile, 0o600);
      } catch (error) {
        logger.warn('Could not restrict session file permissions', {
          sessionFile,
          error: (error as Error).message,
        });
      }
      return result;
    };
    
    return session;
  } else {
    // For development, use StoreSession as normal
    return new StoreSession(sessionDir);
  }
}