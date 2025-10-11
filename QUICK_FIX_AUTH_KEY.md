# Quick Fix for AUTH_KEY_DUPLICATED Error

## Immediate Solution

If you're seeing the `AUTH_KEY_DUPLICATED` error right now, follow these steps:

### Step 1: Stop All Running Instances

```bash
# Find any running uploader processes
ps aux | grep uploader

# Kill them (replace PID with actual process ID)
kill <PID>

# Or kill all at once
pkill -f uploader
```

### Step 2: Clear Your Session

```bash
# Replace YOUR_ACCOUNT with your actual account name
rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT/*
```

### Step 3: Wait a Moment

Wait 1-2 minutes before trying again. This gives Telegram time to clear the old session.

### Step 4: Try Again

```bash
./dist/uploader-linux -a YOUR_ACCOUNT -c upload -i CHAT_ID -f FILE_PATH
```

You'll be asked for your phone code again to create a new session.

## Understanding the Error

The `AUTH_KEY_DUPLICATED` error means:
- The same Telegram session is being used from multiple locations at once
- Telegram detected this and blocked it for security reasons

Common causes:
1. Running the uploader from multiple terminals simultaneously
2. Not waiting for previous upload to finish before starting new one
3. Corrupted or duplicated session files

## Prevention (Built-in from v2.0)

The application now includes automatic protection:

### 1. Process Locking
The app automatically prevents multiple instances:
```bash
# First instance - works fine
./dist/uploader-linux -a account -c upload -i @channel -f file1.jpg

# Second instance (while first is running) - automatically blocked
./dist/uploader-linux -a account -c upload -i @channel -f file2.jpg
# Output: ⚠️  Another instance is already running with this account.
```

### 2. Use the Safe Wrapper Script

For extra safety, use the provided wrapper:

```bash
# Make it executable (first time only)
chmod +x upload-safe.sh

# Use it instead of calling the binary directly
./upload-safe.sh -a account -c upload -i @channel -f file.jpg
```

The wrapper provides:
- ✅ Visual feedback with colors
- ✅ Automatic lock management
- ✅ Clear error messages
- ✅ Cleanup on interruption (Ctrl+C)

## Batch Uploads

If you need to upload multiple files, do it sequentially:

### Option 1: Upload Directory (Recommended)
```bash
# Upload all files in a directory - handled automatically
./upload-safe.sh -a account -c upload -i @channel -f /path/to/directory/
```

### Option 2: Sequential Script
```bash
#!/bin/bash
for file in /path/to/files/*; do
    ./upload-safe.sh -a account -c upload -i @channel -f "$file"
    # Wait a moment between uploads
    sleep 2
done
```

### ❌ DON'T DO THIS:
```bash
# This will cause AUTH_KEY_DUPLICATED errors!
./uploader-linux -a account -c upload -i @channel -f file1.jpg &
./uploader-linux -a account -c upload -i @channel -f file2.jpg &
./uploader-linux -a account -c upload -i @channel -f file3.jpg &
```

## Troubleshooting

### Error persists after clearing session?

1. **Check for zombie processes:**
   ```bash
   ps aux | grep uploader
   killall -9 uploader-linux
   ```

2. **Remove lock files:**
   ```bash
   rm -rf ~/.tgmanager/locks/*
   ```

3. **Wait longer:**
   Sometimes Telegram needs 5-10 minutes to clear the old session

4. **Check session directory:**
   ```bash
   ls -la ~/.tgmanager/sessions/YOUR_ACCOUNT/
   # Should be empty after clearing
   ```

### Still having issues?

1. Log out from Telegram on all other devices
2. Clear the session directory completely
3. Wait 10 minutes
4. Try again with a fresh session

## Technical Details

The error occurs when:
- Telegram's MTProto protocol detects the same `auth_key` in use from multiple connections
- This is a security feature to prevent session hijacking
- Error code: 406
- Error message: "AUTH_KEY_DUPLICATED"

The fix involves:
- Process-level locking to prevent concurrent instances
- Proper session management
- Graceful error handling and recovery
- Clear user feedback

## Need Help?

If you continue to experience issues:
1. Check the logs: `~/.tgmanager/logs/error.log`
2. Verify only one instance is running: `ps aux | grep uploader`
3. Ensure session directory is clean: `ls ~/.tgmanager/sessions/`
4. Try with a different account to isolate the issue
