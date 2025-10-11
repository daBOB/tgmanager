# AUTH_KEY_DUPLICATED Error - Solution Guide

## What is AUTH_KEY_DUPLICATED?

This error occurs when Telegram detects that the same authentication key (session) is being used from multiple locations simultaneously. This is a security feature to prevent unauthorized access.

## Common Causes

1. **Multiple instances running**: Running the binary from different terminals/locations at the same time
2. **Session file conflicts**: Using the same session directory from different binaries
3. **Copied session files**: Copying session files between machines or locations
4. **Concurrent uploads**: Multiple upload processes using the same account simultaneously

## Solutions

### Solution 1: Stop All Running Instances

Before starting a new upload, ensure no other instances are running:

```bash
# Check for running instances
ps aux | grep uploader

# Kill any running instances
pkill -f uploader-linux
# or
killall uploader-linux
```

### Solution 2: Clear and Regenerate Session

If the session is corrupted or duplicated, clear it and regenerate:

```bash
# Remove the session files for your account
rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT_NAME/*

# Run the binary again - it will ask for phone code to create new session
./dist/uploader-linux -a YOUR_ACCOUNT_NAME -c upload -i CHAT_ID -f FILE_PATH
```

### Solution 3: Use Separate Session Directories

If you need to run multiple instances (not recommended), use different session directories:

```bash
# Instance 1
SESSION_DIR=~/.tgmanager/sessions1 ./uploader-linux -a account1 -c upload -i @channel -f file1.jpg

# Instance 2 (different account)
SESSION_DIR=~/.tgmanager/sessions2 ./uploader-linux -a account2 -c upload -i @channel -f file2.jpg
```

### Solution 4: Wait Between Uploads

If you're running sequential uploads, ensure the previous process has fully exited:

```bash
# Upload file 1
./uploader-linux -a account -c upload -i @channel -f file1.jpg
# Wait for it to complete

# Then upload file 2
./uploader-linux -a account -c upload -i @channel -f file2.jpg
```

## Prevention

### 1. Use Process Locking

The application should implement a lock file to prevent multiple instances:

```bash
# Check if lock file exists before running
LOCK_FILE=~/.tgmanager/locks/account_name.lock
if [ -f "$LOCK_FILE" ]; then
    echo "Another instance is running. Please wait."
    exit 1
fi

# Create lock file
mkdir -p ~/.tgmanager/locks
touch "$LOCK_FILE"

# Run your command
./uploader-linux -a account -c upload -i @channel -f file.jpg

# Remove lock file
rm "$LOCK_FILE"
```

### 2. Use a Wrapper Script

Create a wrapper script that handles locking automatically:

```bash
#!/bin/bash
# upload-safe.sh

ACCOUNT="$1"
LOCK_FILE="$HOME/.tgmanager/locks/${ACCOUNT}.lock"
LOCK_DIR="$(dirname "$LOCK_FILE")"

# Create lock directory
mkdir -p "$LOCK_DIR"

# Check for existing lock
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Error: Another instance is running (PID: $PID)"
        exit 1
    else
        echo "Removing stale lock file"
        rm "$LOCK_FILE"
    fi
fi

# Create lock with current PID
echo $$ > "$LOCK_FILE"

# Cleanup function
cleanup() {
    rm -f "$LOCK_FILE"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Run the uploader with all arguments
./dist/uploader-linux "$@"
```

Usage:
```bash
chmod +x upload-safe.sh
./upload-safe.sh -a account -c upload -i @channel -f file.jpg
```

## Troubleshooting

### If error persists after clearing sessions:

1. **Wait 5-10 minutes** before trying again (Telegram may have rate limits)
2. **Check for zombie processes**: `ps aux | grep uploader`
3. **Verify session directory**: Ensure only one session directory is being used
4. **Check file permissions**: Ensure session files are readable/writable

### If you need to use the account urgently:

1. Log out from all other devices using the Telegram app
2. Clear the session directory
3. Re-authenticate with the binary

## Technical Details

The error occurs at the Telegram protocol level when:
- The same auth_key is used in multiple MTProto connections
- Telegram's security system detects concurrent usage
- The session hasn't been properly closed from a previous connection

## Built-in Protection (v2.0+)

Starting from version 2.0, the application includes built-in protection against AUTH_KEY_DUPLICATED errors:

### Automatic Process Locking
- The application automatically creates a lock file when starting
- Prevents multiple instances from running with the same account
- Automatically cleans up on exit (normal or error)
- Detects and removes stale lock files

### Enhanced Error Handling
- Detects AUTH_KEY_DUPLICATED errors automatically
- Provides clear, actionable error messages
- Suggests specific steps to resolve the issue
- Logs detailed information for debugging

### Using the Safe Wrapper Script

A wrapper script `upload-safe.sh` is provided for additional safety:

```bash
# Use the wrapper script instead of calling the binary directly
./upload-safe.sh -a account -c upload -i @channel -f file.jpg
```

The wrapper script provides:
- Visual feedback with colored output
- Explicit lock file management
- Clear error messages
- Automatic cleanup on exit or interruption

## Best Practices

1. **One instance per account**: Never run multiple instances with the same account
2. **Use the wrapper script**: Use `upload-safe.sh` for additional protection
3. **Proper cleanup**: Always let the process exit cleanly (don't force kill)
4. **Session management**: Keep session files in a single, consistent location
5. **Error handling**: Implement proper error handling and cleanup in your scripts
6. **Monitoring**: Log when instances start and stop to track concurrent usage
