import { StringSession, StoreSession } from 'telegram/sessions/index.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import type { Session } from 'telegram/sessions/Abstract.js';

/**
 * Creates a session that works in both development and packaged environments
 */
export function createSession(sessionDir: string): Session {
  // For packaged executables, use file-based StringSession
  if (process.pkg) {
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
      try { chmodSync(sessionFile, 0o600); } catch {}
      return result;
    };
    
    return session;
  } else {
    // For development, use StoreSession as normal
    return new StoreSession(sessionDir);
  }
}