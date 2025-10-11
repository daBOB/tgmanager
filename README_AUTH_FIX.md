# AUTH_KEY_DUPLICATED Error - Complete Solution

## 🚨 Quick Fix (If You're Seeing the Error Now)

```bash
# 1. Stop all running instances
pkill -f uploader

# 2. Clear your session (replace YOUR_ACCOUNT with your account name)
rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT/*

# 3. Wait 1-2 minutes, then try again
./dist/uploader-linux -a YOUR_ACCOUNT -c upload -i CHAT_ID -f FILE_PATH
```

See [QUICK_FIX_AUTH_KEY.md](QUICK_FIX_AUTH_KEY.md) for detailed steps.

---

## ✨ What's New (v2.0)

The application now includes **automatic protection** against AUTH_KEY_DUPLICATED errors:

### Built-in Features
- ✅ **Process Locking**: Prevents multiple instances automatically
- ✅ **Error Detection**: Catches AUTH_KEY_DUPLICATED at all levels
- ✅ **Clear Messages**: Shows exactly what to do when errors occur
- ✅ **Auto Cleanup**: Cleans up properly even on crashes
- ✅ **Stale Lock Removal**: Handles stuck processes intelligently

### No Configuration Needed
Just use the binary as normal - protection is automatic!

```bash
./dist/uploader-linux -a account -c upload -i @channel -f file.jpg
```

---

## 📖 Documentation

### For Users
- **[QUICK_FIX_AUTH_KEY.md](QUICK_FIX_AUTH_KEY.md)** - Immediate solutions when you see the error
- **[AUTH_KEY_DUPLICATED_FIX.md](AUTH_KEY_DUPLICATED_FIX.md)** - Complete guide with all details

### For Developers
- **[CHANGELOG_AUTH_FIX.md](CHANGELOG_AUTH_FIX.md)** - Technical changes and implementation details

---

## 🛡️ Using the Safe Wrapper Script

For extra safety and visual feedback, use the provided wrapper:

```bash
# Make it executable (first time only)
chmod +x upload-safe.sh

# Use it for uploads
./upload-safe.sh -a account -c upload -i @channel -f file.jpg
```

**Benefits:**
- 🎨 Colored output for better visibility
- 🔒 Explicit lock management
- 📝 Clear error messages
- 🧹 Automatic cleanup on Ctrl+C

---

## 📋 Common Scenarios

### Uploading Multiple Files

**✅ Correct Way (Directory Upload):**
```bash
./upload-safe.sh -a account -c upload -i @channel -f /path/to/directory/
```

**✅ Correct Way (Sequential Script):**
```bash
for file in /path/to/files/*; do
    ./upload-safe.sh -a account -c upload -i @channel -f "$file"
    sleep 2
done
```

**❌ Wrong Way (Concurrent):**
```bash
# DON'T DO THIS - Will cause AUTH_KEY_DUPLICATED!
./uploader-linux -a account -c upload -i @channel -f file1.jpg &
./uploader-linux -a account -c upload -i @channel -f file2.jpg &
```

### Checking for Running Instances

```bash
# See if any instances are running
ps aux | grep uploader

# Kill all instances
pkill -f uploader

# Remove lock files if needed
rm -rf ~/.tgmanager/locks/*
```

---

## 🔍 Understanding the Error

**What is AUTH_KEY_DUPLICATED?**
- Telegram detected the same session being used from multiple locations
- This is a security feature to prevent session hijacking
- Error code: 406

**Common Causes:**
1. Running uploader from multiple terminals at once
2. Not waiting for previous upload to finish
3. Corrupted or duplicated session files
4. Zombie processes from previous crashes

**The Fix:**
- Process locking prevents concurrent usage
- Automatic error detection and recovery
- Clear user guidance when errors occur

---

## 🆘 Troubleshooting

### Error Persists After Clearing Session?

1. **Check for zombie processes:**
   ```bash
   ps aux | grep uploader
   killall -9 uploader-linux
   ```

2. **Remove all locks:**
   ```bash
   rm -rf ~/.tgmanager/locks/*
   ```

3. **Wait longer:**
   Telegram may need 5-10 minutes to clear the old session

4. **Verify session is clear:**
   ```bash
   ls -la ~/.tgmanager/sessions/YOUR_ACCOUNT/
   # Should be empty
   ```

### Still Having Issues?

1. Log out from Telegram on all other devices
2. Clear session completely: `rm -rf ~/.tgmanager/sessions/YOUR_ACCOUNT/*`
3. Wait 10 minutes
4. Try with a fresh session

### Check the Logs

```bash
# View error logs
tail -f ~/.tgmanager/logs/error.log

# View application logs
tail -f ~/.tgmanager/logs/app.log
```

---

## 📊 How It Works

### Process Locking Flow

```
Start Upload
    ↓
Check Lock File
    ↓
Lock Exists? ──Yes──→ Check if Process Running
    ↓ No                    ↓ Yes        ↓ No
Create Lock            Show Error    Remove Stale Lock
    ↓                                      ↓
Run Upload ←──────────────────────────────┘
    ↓
Cleanup Lock
    ↓
Exit
```

### Error Detection Points

1. **Client Connection**: Detects during initial connection
2. **Authentication**: Catches during login phase
3. **API Calls**: Monitors all Telegram API interactions
4. **Event Handlers**: Listens for error events

---

## 🎯 Best Practices

1. **Use the wrapper script** for additional safety
2. **Upload directories** instead of individual files when possible
3. **Wait between uploads** if running sequential scripts
4. **Monitor logs** to catch issues early
5. **Keep sessions clean** by not copying them between machines

---

## 📦 What's Included

### New Files
- `src/utils/process-lock.ts` - Process locking implementation
- `upload-safe.sh` - Safe wrapper script
- `AUTH_KEY_DUPLICATED_FIX.md` - Comprehensive guide
- `QUICK_FIX_AUTH_KEY.md` - Quick reference
- `CHANGELOG_AUTH_FIX.md` - Technical changelog
- `README_AUTH_FIX.md` - This file

### Modified Files
- `src/utils/errors.ts` - Added AuthKeyDuplicatedError
- `src/index.ts` - Integrated locking and error handling

---

## 🚀 Getting Started

### First Time Setup

1. **Build the project:**
   ```bash
   npm run build-native
   ```

2. **Make wrapper executable:**
   ```bash
   chmod +x upload-safe.sh
   ```

3. **Use it:**
   ```bash
   ./upload-safe.sh -a account -c upload -i @channel -f file.jpg
   ```

### Upgrading from Previous Version

No migration needed! Just rebuild:
```bash
npm run build-native
```

All existing sessions and configurations continue to work.

---

## 💡 Tips

- Use `upload-safe.sh` for better error messages
- Upload directories instead of individual files
- Check logs if something seems wrong
- Clear sessions if you see persistent errors
- Don't run multiple instances with the same account

---

## 📞 Support

If you need help:
1. Check [QUICK_FIX_AUTH_KEY.md](QUICK_FIX_AUTH_KEY.md)
2. Review logs: `~/.tgmanager/logs/error.log`
3. Verify no zombie processes: `ps aux | grep uploader`
4. Clear sessions if needed: `rm -rf ~/.tgmanager/sessions/ACCOUNT/*`

---

**Version:** 2.0  
**Last Updated:** 2025-10-05  
**Status:** ✅ Production Ready
