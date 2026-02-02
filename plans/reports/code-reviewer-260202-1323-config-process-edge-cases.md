# Configuration & Process Edge Cases Analysis

## Configuration & Process Edge Cases

| # | Edge Case | Status | Evidence | Recommendation |
|---|-----------|--------|----------|----------------|
| **Configuration Edge Cases** |
| 52 | Empty accounts | ✅ | config.ts:58-60 validates and throws error | None - handled |
| 53 | apiId is NaN | ❌ | config.ts:36 parseInt without validation | Add isNaN check after parseInt |
| 54 | MAX_CONCURRENT_UPLOADS=0 | ❌ | config.ts:73 no validation, p-limit(0) = no concurrency | Add minimum value validation (>=1) |
| 55 | Negative UPLOAD_TIMEOUT | ❌ | config.ts:74 no validation for negative values | Add minimum value validation (>0) |
| 56 | Empty SESSION_DIR/UPLOAD_DIR | ⚠️ | config.ts:75-76 uses defaults but empty string bypasses | Add explicit empty string check |
| 57 | TGMANAGER_HOME non-existent | ⚠️ | config-loader.ts:87 returns path without existence check | Path used later with mkdir, but unclear error |
| 58 | Multiple .env files conflict | ✅ | config-loader.ts:52-58 first match wins (break) | None - intentional priority |
| 59 | Hardcoded account names | ⚠️ | config.ts:47 hardcoded array, not user-extensible | Not critical - warn in docs |
| 60 | homedir() undefined | ❌ | config.ts:14 no null check on os.homedir() | Add null/undefined check |
| **Process & Concurrency Edge Cases** |
| 61 | Lock file race condition | ⚠️ | process-lock.ts:29-49 read-check-write not atomic | Low risk - single account usage pattern |
| 62 | PID reuse | ⚠️ | process-lock.ts:31-33 PID could be reused by OS | isProcessRunning() mitigates but not perfect |
| 63 | Corrupted lock file | ❌ | process-lock.ts:31 parseInt on corrupted data = NaN | Add isNaN check, treat as stale lock |
| 64 | Double SIGINT | ⚠️ | process-lock.ts:107-111 process.exit(130) prevents second | Once handler works, but rapid double signals edge case |
| 65 | Multiple uncaughtException handlers | ❌ | process-lock.ts:121 handler can be added multiple times | Use process.once() instead of process.on() |
| 66 | Partial batch failure | ✅ | index.ts:236 Promise.all with results.filter tracking | None - handled correctly |
| 67 | File descriptor limit | ⚠️ | index.ts:225 p-limit controls concurrency but not total FDs | Unlikely with default limit, monitor in production |
| 68 | CWD deleted | ✅ | index.ts:145-146 catches ENOENT and changes to homedir | None - handled |
| 69 | chdir fails | ⚠️ | index.ts:152 catches error but logs and exits unclear | Works but could improve error message |
| **Session & Logging Edge Cases** |
| 70 | Corrupted session file | ❌ | session-helper.ts:22 readFileSync on corrupted data crashes | Add try-catch, fallback to empty session |
| 71 | session.save throws | ❌ | index.ts:72 no error handling on session.save() | Add try-catch with warning log |
| 72 | phoneCode timeout | ⚠️ | index.ts:62 input.text no timeout parameter | Input library handles, but unclear behavior |
| 73 | Password required but missing | ⚠️ | index.ts:60 returns empty string if undefined | Telegram SDK should reject, unclear error |
| 74 | Empty save result | ⚠️ | session-helper.ts:30 writes empty string to file | Edge case - empty session string valid for StringSession |
| 75 | StoreSession conflict | ⚠️ | session-helper.ts:38 directory collision not checked | mkdirSync with recursive handles, but unclear |
| 76 | Logs dir not writable | ❌ | logger.ts:10-17 mkdirSync without error handling | Add try-catch, fallback to console-only logging |
| 77 | Circular reference in error | ⚠️ | logger.ts:103 JSON.stringify could throw on circular | Winston likely handles, but not explicit |
| 78 | Error without message | ⚠️ | errors.ts:94 error.message could be undefined | Rare - Error constructor provides default |
| 79 | Log rotation during write | ✅ | logger.ts:57-69 Winston handles atomically | None - library handles |
| 80 | Error code 406 collision | ✅ | errors.ts:107 AuthKeyDuplicatedError specific class | None - distinct error types |

## Summary by Priority

### Critical (Immediate Fix Required) - 7 issues

1. **apiId is NaN** (#53)
   - Location: config.ts:36
   - Fix: Add isNaN validation after parseInt
   ```typescript
   const parsedId = parseInt(apiId, 10);
   if (isNaN(parsedId)) {
     throw new Error(`Invalid API ID for account: ${accountName}`);
   }
   return { apiId: parsedId, ... };
   ```

2. **MAX_CONCURRENT_UPLOADS=0** (#54)
   - Location: config.ts:73
   - Fix: Add minimum value validation
   ```typescript
   maxConcurrentUploads: Math.max(1, parseInt(process.env.MAX_CONCURRENT_UPLOADS || '1', 10))
   ```

3. **Negative UPLOAD_TIMEOUT** (#55)
   - Location: config.ts:74
   - Fix: Add minimum value validation
   ```typescript
   uploadTimeout: Math.max(1000, parseInt(process.env.UPLOAD_TIMEOUT || '600000', 10))
   ```

4. **homedir() undefined** (#60)
   - Location: config.ts:14
   - Fix: Add null check
   ```typescript
   const home = homedir();
   if (!home) {
     throw new Error('Unable to determine home directory');
   }
   return join(home, filePath.slice(1));
   ```

5. **Corrupted lock file** (#63)
   - Location: process-lock.ts:31
   - Fix: Validate parseInt result
   ```typescript
   const lockPid = parseInt(lockContent, 10);
   if (isNaN(lockPid)) {
     logger.warn('Corrupted lock file, treating as stale');
     this.release();
     // Continue to acquire lock
   }
   ```

6. **Multiple uncaughtException handlers** (#65)
   - Location: process-lock.ts:121
   - Fix: Use once() instead of on()
   ```typescript
   process.once('uncaughtException', (error) => { ... });
   process.once('unhandledRejection', (reason, promise) => { ... });
   ```

7. **Corrupted session file** (#70)
   - Location: session-helper.ts:22
   - Fix: Add try-catch
   ```typescript
   try {
     sessionString = readFileSync(sessionFile, 'utf-8').trim();
   } catch (error) {
     logger.warn('Failed to read session file, starting fresh', { error });
     sessionString = '';
   }
   ```

### Medium (Should Fix) - 6 issues

1. **Empty SESSION_DIR/UPLOAD_DIR** (#56) - Add explicit check for empty strings
2. **TGMANAGER_HOME non-existent** (#57) - Improve error message when path invalid
3. **session.save throws** (#71) - Add try-catch with warning
4. **Logs dir not writable** (#76) - Add try-catch, fallback to console-only
5. **phoneCode timeout** (#72) - Document expected behavior
6. **Password required but missing** (#73) - Improve error message clarity

### Low (Monitor) - 8 issues

1. **Lock file race condition** (#61) - Low risk in single-account pattern
2. **PID reuse** (#62) - OS reuse rare, mitigated by isProcessRunning
3. **Double SIGINT** (#64) - Edge case, current implementation sufficient
4. **File descriptor limit** (#67) - Monitor in production
5. **chdir fails** (#69) - Works but could improve messaging
6. **Empty save result** (#74) - Edge case, valid for StringSession
7. **StoreSession conflict** (#75) - Handled by mkdir recursive
8. **Circular reference in error** (#77) - Winston likely handles
9. **Error without message** (#78) - Rare, Error provides default

### Already Handled - 5 issues

1. **Empty accounts** (#52) - Validated with clear error
2. **Multiple .env files conflict** (#58) - First wins by design
3. **Partial batch failure** (#66) - Tracked and reported correctly
4. **CWD deleted** (#68) - Catches ENOENT and recovers
5. **Log rotation during write** (#79) - Winston handles atomically
6. **Error code 406 collision** (#80) - Distinct error classes

## Unresolved Questions

1. Should MAX_CONCURRENT_UPLOADS have a maximum value (e.g., 10) to prevent resource exhaustion?
2. Should UPLOAD_TIMEOUT have a maximum value to prevent indefinite hangs?
3. Should account names be configurable via environment variable pattern (e.g., TGMANAGER_ACCOUNTS="account1,account2")?
4. Should corrupted lock files trigger a notification/alert in production?
5. Should session save failures be fatal or just logged as warnings?
