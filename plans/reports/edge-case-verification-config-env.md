# Edge Case Verification Report: Configuration & Environment

**Category**: Configuration & Environment
**Date**: 2026-02-05
**Project**: TGManager
**Scope**: Cases 29-35

---

## Executive Summary

**Critical Issues**: 3
**Partial Handling**: 2
**Well Handled**: 2

**Priority Fixes Required**:
1. Module initialization order causes ENOENT crashes before fix can run
2. `require()` in ESM context works via TypeScript but is fragile
3. Windows path handling will fail silently

---

## Case 29: Hardcoded Account Names

**Location**: `src/config.ts:53`

**Status**: ⚠️ **PARTIAL**

**Analysis**:
```typescript
// Line 53: Only these 4 accounts are checked
const accountNames = ['nitewalker', 'masterclass', 'junkies', 'nicenstein'];

// Line 56-62: Unconfigured accounts get warning, continue
try {
  accounts[name] = getAccountConfig(name);
} catch (error) {
  console.warn(`Warning: ${(error as Error).message}`);
}

// src/utils/validation.ts:56-65: validateAccountName() checks dynamic list
export function validateAccountName(accountName: string, availableAccounts: string[]) {
  if (!availableAccounts.includes(accountName)) {
    throw new Error(`Invalid account name: ${accountName}...`);
  }
}
```

**Issue**:
- User with account "newaccount" in .env:
  - `buildAccounts()` never checks "newaccount" (not in hardcoded list)
  - `validateAccountName()` receives empty/partial `Object.keys(config.accounts)`
  - Runtime validation works but account is unusable
  - No error, just silently ignored

**Missing**:
- No mechanism to discover accounts from environment variables
- No validation that checks env vars against hardcoded list
- User gets no feedback that their account exists but won't be used

**Recommendation**:
```typescript
// Dynamic discovery approach
const buildAccounts = (): Record<string, AccountConfig> => {
  const accounts: Record<string, AccountConfig> = {};

  // Discover all account prefixes from environment
  const accountPrefixes = new Set<string>();
  for (const key in process.env) {
    const match = key.match(/^([A-Z]+)_(API_ID|API_HASH|PHONE|PASSWORD)$/);
    if (match) {
      accountPrefixes.add(match[1].toLowerCase());
    }
  }

  // Build accounts from discovered prefixes
  for (const name of accountPrefixes) {
    try {
      accounts[name] = getAccountConfig(name);
    } catch (error) {
      console.warn(`Warning: ${(error as Error).message}`);
    }
  }

  // Validate at least one account exists
  if (Object.keys(accounts).length === 0) {
    throw new Error('No accounts configured...');
  }

  return accounts;
};
```

---

## Case 30: process.cwd() Before CWD Fix

**Location**: `src/config-loader.ts:41` called from `src/config.ts:7`

**Status**: ❌ **UNHANDLED - CRITICAL**

**Analysis**:

**Module Initialization Order**:
```
1. logger.ts:10-12    → logsDir = join(process.cwd(), 'logs')  [ENOENT risk]
2. config-loader.ts:7 → import logger
3. config.ts:4        → import config-loader
4. config.ts:7        → loadConfig() executes at module level
5. config-loader.ts:41→ process.cwd() called                    [ENOENT risk]
6. index.ts:9         → import config (all above already ran)
7. index.ts:149-165   → CWD ENOENT fix runs (TOO LATE)
```

**Proof of Vulnerability**:
```bash
# Simulate scenario
$ cd /tmp/testdir
$ ./uploader-linux -a nitewalker
$ rm -rf /tmp/testdir  # Delete CWD from another terminal
# Result: Crash at logger initialization or config loading
# The fix at index.ts:149 never executes
```

**Current Fix Location** (index.ts:149-165):
```typescript
try {
  process.cwd();
} catch (cwdError: any) {
  if (cwdError.code === 'ENOENT') {
    process.chdir(require('os').homedir());  // See Case 32
  }
}
```

**Why It Fails**:
1. Logger imports first, calls `process.cwd()` at module level (line 10)
2. Config-loader imports logger, then calls `loadConfig()` at module level
3. `loadConfig()` calls `process.cwd()` at line 41
4. **All module-level code executes BEFORE `main()` function**
5. Fix in `main()` never runs if earlier imports crash

**Impact**: **SEVERE**
- Packaged executable crashes immediately if CWD deleted
- No error recovery possible
- Silent failure mode (no helpful error message)

**Fix Required**:
Move CWD validation to earliest possible point:

```typescript
// NEW FILE: src/early-init.ts
// Must be imported FIRST in index.ts, before logger/config

export function ensureValidCwd(): void {
  try {
    process.cwd();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const os = await import('os');  // ESM-safe
      process.chdir(os.homedir());
      console.warn('Working directory invalid, using home directory');
    } else {
      throw error;
    }
  }
}

// src/index.ts:1
import { ensureValidCwd } from './early-init.js';
ensureValidCwd();  // MUST be first statement
import logger from './logger.js';  // Now safe
import config from './config.js';  // Now safe
```

---

## Case 31: Logger Initialized Before Config

**Location**: `src/logger.ts:10-12`

**Status**: ✅ **HANDLED**

**Analysis**:
```typescript
// logger.ts:50
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',  // Reads directly from env
  // ...
});
```

**Why It Works**:
- Logger reads `LOG_LEVEL` directly from `process.env`, not from config object
- `config-loader.ts:55` loads .env via `dotenv.config()` which populates `process.env`
- Execution order:
  1. `logger.ts` imports → creates logger with default/env `LOG_LEVEL`
  2. `config-loader.ts` imports logger → then calls `loadConfig()`
  3. `loadConfig()` calls `dotenv.config()` → **too late for logger init**

**However**:
- If .env is loaded successfully, `process.env.LOG_LEVEL` is set BEFORE logger initialization
- Works by accident, not by design
- Fragile dependency on module loading order

**No Circular Dependency**:
- Logger doesn't import config-loader
- Config-loader imports logger
- One-way dependency: ✅ Safe

**Minor Issue**:
- If `dotenv.config()` fails, logger still uses `'info'` default
- No warning if LOG_LEVEL in .env is malformed (e.g., "DEBUGGG")

**Recommendation**: Add validation
```typescript
// logger.ts
const validLevels = ['error', 'warn', 'info', 'debug'];
const configuredLevel = process.env.LOG_LEVEL || 'info';
const level = validLevels.includes(configuredLevel) ? configuredLevel : 'info';

if (!validLevels.includes(configuredLevel)) {
  console.warn(`Invalid LOG_LEVEL '${configuredLevel}', using 'info'`);
}
```

---

## Case 32: require() in ESM Context

**Location**: `src/index.ts:155`

**Status**: ⚠️ **PARTIAL**

**Analysis**:

**Source Code**:
```typescript
// index.ts:155 (TypeScript)
process.chdir(require('os').homedir());
```

**Compiled Output**:
```javascript
// dist/index.js:128 (JavaScript)
process.chdir(require('os').homedir());
```

**TypeScript Behavior**:
- TypeScript compiles `require()` directly to output
- **No** transformation to ESM `import()`
- Assumes Node.js will provide `require()` at runtime

**Node.js ESM Behavior** (package.json has `"type": "module"`):
```bash
$ node --input-type=module -e "console.log(typeof require)"
undefined

$ node dist/index.js  # With "type": "module"
ReferenceError: require is not defined
```

**Why It Currently Works**:
- Package.json specifies `"type": "module"`
- BUT executable is bundled via `pkg` (line 58: `bundle-pkg`)
- `pkg` creates **CommonJS** bundle regardless of source type
- CommonJS runtime provides `require()` globally

**Fragility**:
1. Running unbundled dist files in pure ESM mode → **CRASH**
2. Changing bundler configuration → **CRASH**
3. Running via `npm start` → **CRASH** (uses Node ESM)

**Testing**:
```bash
# This will fail:
$ node dist/index.js -a nitewalker
# ReferenceError: require is not defined
```

**Fix Required**:
```typescript
// Option 1: Use import() expression (works in both ESM and TypeScript)
import('os').then(os => process.chdir(os.homedir()));

// Option 2: Top-level import (recommended)
import { homedir } from 'os';
// ... later:
process.chdir(homedir());

// Option 3: createRequire (already imported but unused)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
process.chdir(require('os').homedir());
```

**Impact**: **MEDIUM**
- Production executables work (bundled as CommonJS)
- Development and testing broken (unbundled ESM)
- Future migration to pure ESM blocked

---

## Case 33: Unused Import createRequire

**Location**: `src/config-loader.ts:6`

**Status**: ✅ **HANDLED** (Dead Code)

**Analysis**:
```typescript
// Line 6: imported but never used
import { createRequire } from 'module';
```

**Verification**:
```bash
$ grep -n "createRequire" dist/*.js
# No output → Not in compiled code
```

**Why It Exists**:
- Likely added to prepare for `require()` in ESM
- Never implemented
- TypeScript compiler tree-shakes it away
- Bundler removes it

**Impact**: **NONE**
- No runtime effect
- Minor IDE/linting noise
- Confusing for code readers

**Recommendation**: Remove
```typescript
// Remove line 6 from config-loader.ts
- import { createRequire } from 'module';
```

---

## Case 34: expandPath with Windows Backslashes

**Location**: `src/config.ts:13-22`

**Status**: ❌ **UNHANDLED**

**Analysis**:

**Current Implementation**:
```typescript
const expandPath = (filePath: string): string => {
  if (filePath.startsWith('~')) {           // Check 1
    return join(homedir(), filePath.slice(1));
  }
  if (!filePath.startsWith('/')) {          // Check 2
    return join(configBaseDir, filePath);
  }
  return filePath;
};
```

**Windows Path Tests**:
```javascript
// Absolute Windows path
'C:\\Users\\test'.startsWith('~')  → false
'C:\\Users\\test'.startsWith('/')  → false
// Result: Treated as relative path, prepended with configBaseDir
// Final: '/home/user/.tgmanager/C:\\Users\\test' ← WRONG

// Relative Windows path
'sessions\\data'.startsWith('~')   → false
'sessions\\data'.startsWith('/')   → false
// Result: Correctly treated as relative
// Final: '/home/user/.tgmanager/sessions/data' ← OK
```

**Cross-Platform Path Detection**:
```typescript
import { isAbsolute } from 'path';

const expandPath = (filePath: string): string => {
  // Handle home directory expansion
  if (filePath.startsWith('~')) {
    return join(homedir(), filePath.slice(1));
  }

  // Use Node.js built-in absolute path detection
  if (isAbsolute(filePath)) {
    return filePath;  // Already absolute, don't modify
  }

  // Relative path: make relative to config directory
  return join(configBaseDir, filePath);
};
```

**`path.isAbsolute()` Behavior**:
```javascript
// Unix
isAbsolute('/home/user')        → true
isAbsolute('home/user')         → false

// Windows
isAbsolute('C:\\Users\\test')   → true
isAbsolute('\\\\server\\share') → true
isAbsolute('sessions\\data')    → false
```

**Impact**: **MEDIUM-HIGH**
- Windows users with absolute paths in .env get corrupted paths
- Sessions stored in wrong location
- Uploads go to wrong directory
- Silent failure (no error, just wrong behavior)

**Fix Required**: Use `path.isAbsolute()`

---

## Case 35: Logger logsDir with ENOENT CWD (Packaged)

**Location**: `src/logger.ts:10-12`

**Status**: ❌ **UNHANDLED - CRITICAL**

**Analysis**:

**Current Code**:
```typescript
// Line 10-12: Executed at module load time
const logsDir = process.pkg
  ? join(process.cwd(), 'logs')    // ← ENOENT crash risk
  : join(dirname(__dirname), 'logs');

// Line 15-17: Directory creation (only in dev mode)
if (!process.pkg && !existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}
```

**Vulnerability Scenario**:
```bash
# User runs packaged executable
$ cd /tmp/workspace
$ ./uploader-linux -a nitewalker &
[1] 12345

# User deletes directory (accidentally or intentionally)
$ rm -rf /tmp/workspace

# Process wakes up or new invocation
$ ./uploader-linux -a nitewalker
# Crash at line 10: process.cwd() throws ENOENT
# index.ts:149 never reached
```

**Execution Order** (Same as Case 30):
```
1. logger.ts:10       → process.cwd() called        [CRASH HERE]
2. index.ts:149-165   → CWD fix code                [NEVER REACHED]
```

**Additional Issue**:
```typescript
// Line 15-17: Only creates dir in development
if (!process.pkg && !existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}
```

**Compound Failure**:
- Even if CWD is valid, logs directory might not exist
- Packaged app (`process.pkg === true`) **skips** directory creation
- Winston file transports will fail when trying to write
- No early validation or creation

**Impact**: **SEVERE**
- Same root cause as Case 30
- Affects both development and production
- Logger is first import, earliest crash point

**Fix Required** (Combined with Case 30):

```typescript
// NEW FILE: src/early-init.ts
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function ensureValidEnvironment(): Promise<string> {
  // Fix 1: Ensure valid CWD
  let validCwd: string;
  try {
    validCwd = process.cwd();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const os = await import('os');
      validCwd = os.homedir();
      try {
        process.chdir(validCwd);
        console.warn('⚠️  Working directory invalid, using home directory');
      } catch {
        console.error('❌ Cannot change to valid directory');
        process.exit(1);
      }
    } else {
      throw error;
    }
  }

  // Fix 2: Determine and create logs directory
  const logsDir = process.pkg
    ? join(validCwd, 'logs')
    : join(dirname(__dirname), 'logs');

  if (!existsSync(logsDir)) {
    try {
      mkdirSync(logsDir, { recursive: true });
    } catch (error: any) {
      console.error(`❌ Cannot create logs directory: ${error.message}`);
      // Don't exit, logger will fail gracefully
    }
  }

  return logsDir;
}

// src/logger.ts
import { ensureValidEnvironment } from './early-init.js';

// MUST be synchronous or make logger init async
const logsDir = await ensureValidEnvironment();
// ... rest of logger initialization
```

---

## Summary of Issues

### Critical (Requires Immediate Fix)

1. **Case 30 & 35: Module Initialization Order** ❌
   - `process.cwd()` called before fix can run
   - Crashes on ENOENT before `main()` executes
   - **Fix**: Move CWD validation to earliest import

2. **Case 32: require() in ESM** ⚠️
   - Works accidentally (bundler saves it)
   - Breaks in development/unbundled scenarios
   - **Fix**: Use proper ESM imports

3. **Case 34: Windows Path Handling** ❌
   - Absolute paths incorrectly treated as relative
   - Corrupts file locations on Windows
   - **Fix**: Use `path.isAbsolute()`

### Medium Priority

4. **Case 29: Hardcoded Accounts** ⚠️
   - Valid .env accounts silently ignored
   - No dynamic discovery
   - **Fix**: Parse environment for account prefixes

### Low Priority (Cleanup)

5. **Case 31: Logger Before Config** ✅
   - Works by accident, fragile
   - **Improve**: Add LOG_LEVEL validation

6. **Case 33: Dead Import** ✅
   - No functional impact
   - **Cleanup**: Remove unused import

---

## Recommendations

### Immediate Actions

1. **Refactor initialization order**:
   - Create `early-init.ts` for CWD and logs validation
   - Import at top of `index.ts` before any other imports
   - Make synchronous or use top-level await

2. **Fix ESM compatibility**:
   - Replace `require('os')` with proper import
   - Test unbundled execution: `node dist/index.js`

3. **Add Windows support**:
   - Replace `filePath.startsWith('/')` with `path.isAbsolute()`
   - Test on Windows or with Windows-style paths

### Follow-Up Actions

4. **Dynamic account discovery**:
   - Scan `process.env` for account prefixes
   - Remove hardcoded account list
   - Add tests with arbitrary account names

5. **Code cleanup**:
   - Remove unused `createRequire` import
   - Add LOG_LEVEL validation
   - Document module initialization order

---

## Test Cases

### Case 30 & 35: CWD ENOENT
```bash
# Setup
mkdir /tmp/test-enoent
cd /tmp/test-enoent

# Start process (background)
./uploader-linux -a nitewalker &
PID=$!

# Delete CWD while running
rm -rf /tmp/test-enoent

# Trigger operation
kill -USR1 $PID  # or wait for automatic operation

# Expected (before fix): Crash
# Expected (after fix): Continues with homedir
```

### Case 32: ESM require()
```bash
# Test unbundled execution
npm run build:ts
node dist/index.js -a nitewalker

# Expected (before fix): ReferenceError: require is not defined
# Expected (after fix): Works normally
```

### Case 34: Windows Paths
```typescript
// Add to test suite
import { config } from './config.js';

// Mock Windows environment
process.env.SESSION_DIR = 'C:\\Users\\test\\sessions';
process.env.UPLOAD_DIR = 'D:\\uploads';

// Reload config
const cfg = loadConfig();

// Verify absolute paths preserved
assert(cfg.app.sessionDir === 'C:\\Users\\test\\sessions');
assert(cfg.app.uploadDir === 'D:\\uploads');
```

### Case 29: Dynamic Accounts
```bash
# Add arbitrary account to .env
MYACCOUNT_API_ID=12345
MYACCOUNT_API_HASH=abcdef
MYACCOUNT_PHONE=+1234567890

# Should discover automatically
./uploader-linux -a myaccount

# Expected (before fix): Error: Invalid account name
# Expected (after fix): Works normally
```

---

## Risk Assessment

| Case | Severity | Likelihood | Risk Score | Priority |
|------|----------|------------|------------|----------|
| 30   | HIGH     | MEDIUM     | **8/10**   | P0       |
| 32   | MEDIUM   | LOW        | **4/10**   | P2       |
| 34   | HIGH     | LOW        | **6/10**   | P1       |
| 35   | HIGH     | MEDIUM     | **8/10**   | P0       |
| 29   | LOW      | MEDIUM     | **3/10**   | P3       |
| 31   | LOW      | LOW        | **2/10**   | P4       |
| 33   | NONE     | N/A        | **0/10**   | P5       |

**P0 = Critical**, **P1 = High**, **P2 = Medium**, **P3 = Low**, **P4 = Minor**, **P5 = Cleanup**

---

## Conclusion

**Critical initialization order issues** exist. Both logger and config initialization call `process.cwd()` before the ENOENT fix can execute. This creates crash scenarios in production that are difficult to debug.

**Recommended Fix Priority**:
1. Cases 30 & 35 (initialization order) - **Critical**
2. Case 34 (Windows paths) - **High**
3. Case 32 (ESM require) - **Medium**
4. Case 29 (dynamic accounts) - **Low**
5. Cases 31 & 33 (cleanup) - **Minor**

Combined fix for Cases 30 & 35 resolves both issues with single refactor.
