# Fix: ENOENT: no such file or directory, uv_cwd

## Error Message
```
Error: ENOENT: no such file or directory, uv_cwd
    at process.wrappedCwd [as cwd]
```

## What This Means

This error occurs when the **current working directory** (the directory you're running the command from) no longer exists. This commonly happens when:

1. ❌ You're in a directory that was deleted
2. ❌ You're on a mounted drive that was unmounted (USB, network share, etc.)
3. ❌ The directory was moved or renamed while you were in it
4. ❌ You're in a directory on a drive that's no longer accessible

## Immediate Fix

### Option 1: Change to Home Directory (Recommended)

```bash
# Change to your home directory first
cd ~

# Then run your command with absolute path to the binary
~/Workspace/tgmanager/dist/uploader-linux -a nitewalker -c upload -i -1002192357718 -f "/media/andre/Storage/Nicenstein/Maeurn Smiles" --delete-source
```

### Option 2: Change to Any Valid Directory

```bash
# Change to any directory that exists
cd /tmp

# Or
cd /home/andre

# Then run your command
/home/andre/Workspace/tgmanager/dist/uploader-linux -a nitewalker -c upload -i -1002192357718 -f "/path/to/files" --delete-source
```

## Verify Your Paths

Before running the upload, verify both paths exist:

### 1. Check if the upload source exists:
```bash
# Check if the directory/file you want to upload exists
ls -la "/media/andre/Storage/Nicenstein/Maeurn Smiles"
```

If this fails, the path doesn't exist or the drive isn't mounted.

### 2. Check if the drive is mounted:
```bash
# See all mounted drives
df -h

# Check specifically for your Storage drive
df -h | grep Storage

# Or check mount points
mount | grep Storage
```

### 3. Check the binary location:
```bash
# Verify the uploader binary exists
ls -la ~/Workspace/tgmanager/dist/uploader-linux
```

## Common Scenarios

### Scenario 1: External Drive Not Mounted

**Problem:** You're trying to upload from `/media/andre/Storage/...` but the drive isn't mounted.

**Solution:**
```bash
# Check if drive is mounted
df -h | grep Storage

# If not mounted, mount it (adjust device name as needed)
# Example for USB drive:
sudo mount /dev/sdb1 /media/andre/Storage

# Or use your file manager to mount it, then try again
```

### Scenario 2: You Were in a Deleted Directory

**Problem:** You were in a directory that no longer exists.

**Solution:**
```bash
# Try to see where you are
pwd
# This might fail with the same error

# Change to home directory
cd ~

# Verify you're in a valid directory
pwd
# Should show: /home/andre

# Now run your command
```

### Scenario 3: Network Drive Disconnected

**Problem:** You were in a network share that disconnected.

**Solution:**
```bash
# Reconnect to the network share first
# Then change to a local directory
cd ~

# Run your command
```

## Using the Wrapper Script

The wrapper script handles this better:

```bash
# The wrapper automatically changes to a valid directory
cd ~ && ./upload-safe.sh -a nitewalker -c upload -i -1002192357718 -f "/media/andre/Storage/Nicenstein/Maeurn Smiles" --delete-source
```

## Best Practices

### 1. Always Use Absolute Paths

```bash
# ✅ Good - absolute paths
/home/andre/Workspace/tgmanager/dist/uploader-linux -a account -c upload -i @channel -f "/absolute/path/to/files"

# ❌ Bad - relative paths when cwd might not exist
./uploader-linux -a account -c upload -i @channel -f "relative/path"
```

### 2. Run from a Stable Directory

```bash
# ✅ Good - run from home directory
cd ~
./Workspace/tgmanager/dist/uploader-linux ...

# ❌ Bad - run from mounted/temporary directory
cd /media/andre/Storage
./uploader-linux ...
```

### 3. Check Paths Before Running

```bash
# Create a simple check script
#!/bin/bash

UPLOAD_PATH="/media/andre/Storage/Nicenstein/Maeurn Smiles"

# Check if path exists
if [ ! -e "$UPLOAD_PATH" ]; then
    echo "Error: Upload path does not exist: $UPLOAD_PATH"
    echo "Please check if the drive is mounted."
    exit 1
fi

# Change to home directory
cd ~

# Run upload
./Workspace/tgmanager/dist/uploader-linux -a nitewalker -c upload -i -1002192357718 -f "$UPLOAD_PATH" --delete-source
```

## Automated Fix (v2.1+)

Starting from version 2.1, the application automatically handles this:

- ✅ Detects when current directory doesn't exist
- ✅ Automatically changes to home directory
- ✅ Logs a warning about the change
- ✅ Continues with the upload

Just rebuild and the fix is included:
```bash
npm run build-native
```

## Troubleshooting

### Still Getting the Error?

1. **Verify you're in a valid directory:**
   ```bash
   pwd
   # If this fails, you're in an invalid directory
   ```

2. **Force change to home:**
   ```bash
   cd ~ || cd /tmp
   ```

3. **Use absolute paths for everything:**
   ```bash
   /home/andre/Workspace/tgmanager/dist/uploader-linux -a nitewalker -c upload -i -1002192357718 -f "/media/andre/Storage/Nicenstein/Maeurn Smiles" --delete-source
   ```

4. **Check if the upload path exists:**
   ```bash
   ls -la "/media/andre/Storage/Nicenstein/Maeurn Smiles"
   ```

### Mount Point Issues

If your external drive keeps unmounting:

```bash
# Check system logs
dmesg | tail -20

# Check if drive has errors
sudo fsck /dev/sdb1  # Adjust device name

# Try remounting
sudo umount /media/andre/Storage
sudo mount /dev/sdb1 /media/andre/Storage
```

## Quick Reference

```bash
# The complete safe command:
cd ~ && /home/andre/Workspace/tgmanager/dist/uploader-linux -a nitewalker -c upload -i -1002192357718 -f "/media/andre/Storage/Nicenstein/Maeurn Smiles" --delete-source

# Or with the wrapper:
cd ~ && /home/andre/Workspace/tgmanager/upload-safe.sh -a nitewalker -c upload -i -1002192357718 -f "/media/andre/Storage/Nicenstein/Maeurn Smiles" --delete-source
```

## Summary

**The Problem:** Current directory doesn't exist  
**The Solution:** Change to a valid directory first (like `cd ~`)  
**Prevention:** Always use absolute paths and run from stable directories  
**Automatic Fix:** Included in v2.1+ (rebuild to get it)
