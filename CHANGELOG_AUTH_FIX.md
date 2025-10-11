# Changelog - AUTH_KEY_DUPLICATED Fix

## Version 2.0 - AUTH_KEY_DUPLICATED Protection

### Summary
Implemented comprehensive protection against the `AUTH_KEY_DUPLICATED` error that occurs when the same Telegram session is used from multiple locations simultaneously.

### Changes Made

#### 1. New Error Handling (`src/utils/errors.ts`)
- Added `AuthKeyDuplicatedError` class for specific error handling
- Enhanced error handler to detect and handle AUTH_KEY_DUPLICATED (error code 406)
- Provides user-friendly error messages with actionable steps
- Logs detailed information for debugging

#### 2. Process Locking System (`src/utils/process-lock.ts`)
- New `ProcessLock` class to prevent concurrent instances
- Automatically creates lock files per account
- Detects and removes stale lock files
- Handles cleanup on exit, interruption (Ctrl+C), and errors
- Cross-platform compatible (Linux, macOS, Windows)

#### 3. Enhanced Main Application (`src/index.ts`)
- Integrated process locking into startup sequence
- Detects AUTH_KEY_DUPLICATED errors at multiple points:
  - During client connection
  - During authentication
  - During API calls
- Provides clear error messages to users
- Ensures proper cleanup even on errors

#### 4. Safe Wrapper Script (`upload-safe.sh`)
- Bash script for additional safety layer
- Visual feedback with colored output
- Explicit lock file management
- Handles edge cases and provides helpful error messages
- Easy to use: `./upload-safe.sh -a account -c upload -i @channel -f file.jpg`

#### 5. Documentation
- `AUTH_KEY_DUPLICATED_FIX.md` - Comprehensive guide
- `QUICK_FIX_AUTH_KEY.md` - Quick reference for immediate fixes
- `CHANGELOG_AUTH_FIX.md` - This file

### Features

#### Automatic Protection
✅ Prevents multiple instances from running with the same account
✅ Detects and handles AUTH_KEY_DUPLICATED errors gracefully
✅ Provides clear, actionable error messages
✅ Automatic cleanup on exit or error
✅ Stale lock file detection and removal

#### User Experience
✅ Clear error messages with step-by-step solutions
✅ Visual feedback (colored output in wrapper script)
✅ No manual intervention needed in most cases
✅ Graceful degradation when errors occur

#### Developer Experience
✅ Comprehensive error logging
✅ Easy to debug with detailed error information
✅ Clean code structure with separation of concerns
✅ Well-documented with inline comments

### Usage

#### Basic Usage (Built-in Protection)
```bash
# The binary now includes automatic protection
./dist/uploader-linux -a account -c upload -i @channel -f file.jpg
```

#### Enhanced Usage (Wrapper Script)
```bash
# Use the wrapper for additional safety and visual feedback
./upload-safe.sh -a account -c upload -i @channel -f file.jpg
```

#### Batch Uploads
```bash
# Upload entire directory (handled automatically)
./upload-safe.sh -a account -c upload -i @channel -f /path/to/directory/
```

### Error Recovery

If you encounter AUTH_KEY_DUPLICATED error:

1. **Automatic**: The app will show clear instructions
2. **Manual**: Follow the quick fix guide in `QUICK_FIX_AUTH_KEY.md`
3. **Persistent**: Clear session and wait: `rm -rf ~/.tgmanager/sessions/ACCOUNT/*`

### Technical Implementation

#### Lock File Location
- Default: `~/.tgmanager/locks/ACCOUNT_NAME.lock`
- Contains: Process ID (PID) of running instance
- Cleaned up: Automatically on exit

#### Error Detection Points
1. Client connection initialization
2. Authentication phase
3. API call execution
4. Error event handlers

#### Cleanup Handlers
- Normal exit: `process.on('exit')`
- Ctrl+C: `process.on('SIGINT')`
- Kill signal: `process.on('SIGTERM')`
- Uncaught exceptions: `process.on('uncaughtException')`
- Unhandled rejections: `process.on('unhandledRejection')`

### Testing

The fix has been tested with:
- ✅ Single instance operation
- ✅ Multiple instance prevention
- ✅ Stale lock file handling
- ✅ Error recovery
- ✅ Graceful shutdown
- ✅ Forced termination (Ctrl+C)
- ✅ Batch uploads
- ✅ Directory uploads

### Migration

No migration needed! The changes are backward compatible:
- Existing sessions continue to work
- No configuration changes required
- Automatic protection is enabled by default

### Files Modified

1. `src/utils/errors.ts` - Added AuthKeyDuplicatedError class
2. `src/utils/process-lock.ts` - New file for process locking
3. `src/index.ts` - Integrated locking and error handling
4. `package.json` - No changes needed
5. `scripts/bundle-for-pkg.cjs` - No changes needed

### Files Added

1. `src/utils/process-lock.ts` - Process locking implementation
2. `upload-safe.sh` - Safe wrapper script
3. `AUTH_KEY_DUPLICATED_FIX.md` - Comprehensive documentation
4. `QUICK_FIX_AUTH_KEY.md` - Quick reference guide
5. `CHANGELOG_AUTH_FIX.md` - This changelog

### Breaking Changes

None! All changes are backward compatible.

### Known Limitations

1. Lock files are per-account, not per-session directory
2. Stale lock detection relies on process existence check
3. Cross-machine locking not supported (by design)

### Future Improvements

Potential enhancements for future versions:
- [ ] Configurable lock timeout
- [ ] Lock file expiration
- [ ] Multi-account concurrent support with different sessions
- [ ] Web dashboard for monitoring active instances
- [ ] Automatic session rotation

### Support

For issues or questions:
1. Check `QUICK_FIX_AUTH_KEY.md` for immediate solutions
2. Review logs: `~/.tgmanager/logs/error.log`
3. Verify no zombie processes: `ps aux | grep uploader`
4. Clear sessions if needed: `rm -rf ~/.tgmanager/sessions/ACCOUNT/*`
