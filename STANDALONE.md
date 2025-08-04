# Using TGManager Standalone Executables

This guide explains how to use the compiled standalone executables (`.exe`, Linux binary, macOS binary) with credential management.

## Configuration Options

The standalone executables support multiple ways to provide credentials:

### 1. Configuration File (.env)

The executable looks for `.env` files in these locations (in order):

1. **Current directory**: `./env`
2. **Next to executable**: `/path/to/executable/.env`
3. **User config directory**: `~/.tgmanager/.env`
4. **System-wide**: `/etc/tgmanager/.env` (Linux/macOS)

#### Example Setup

Create `~/.tgmanager/.env`:
```bash
mkdir -p ~/.tgmanager
cat > ~/.tgmanager/.env << EOF
# Account credentials
NITEWALKER_API_ID=123456
NITEWALKER_API_HASH=your_api_hash_here
NITEWALKER_PHONE=+1234567890
NITEWALKER_PASSWORD=your_password_here

# Settings
SESSION_DIR=~/.tgmanager/sessions
UPLOAD_DIR=~/uploads
LOG_LEVEL=info
EOF
```

### 2. Environment Variables

Set credentials as system environment variables:

#### Linux/macOS:
```bash
export NITEWALKER_API_ID=123456
export NITEWALKER_API_HASH=your_api_hash
export NITEWALKER_PHONE=+1234567890
export NITEWALKER_PASSWORD=your_password

./tgmanager-linux -a nitewalker -c upload -i @channel -f file.mp4
```

#### Windows:
```cmd
set NITEWALKER_API_ID=123456
set NITEWALKER_API_HASH=your_api_hash
set NITEWALKER_PHONE=+1234567890
set NITEWALKER_PASSWORD=your_password

tgmanager.exe -a nitewalker -c upload -i @channel -f file.mp4
```

### 3. Custom Config Location

Specify a custom `.env` file location:

```bash
TGMANAGER_CONFIG=/path/to/my/config.env ./tgmanager-linux -a myaccount -c upload -i @channel -f file.mp4
```

## Directory Structure

When using standalone executables, the recommended directory structure is:

```
~/.tgmanager/
├── .env          # Your credentials
├── sessions/     # Telegram session files
└── uploads/      # Default upload directory
```

## Security Best Practices

1. **File Permissions**: Protect your `.env` file:
   ```bash
   chmod 600 ~/.tgmanager/.env
   ```

2. **Don't Share Executables**: Never share executables that might have embedded credentials

3. **Use User Directory**: Store configs in your home directory, not next to the executable

4. **Avoid Current Directory**: Don't leave `.env` files in random directories

## Usage Examples

### Basic Upload
```bash
# Using config from ~/.tgmanager/.env
./tgmanager-linux -a myaccount -c upload -i @mychannel -f video.mp4
```

### With Custom Config
```bash
# Using specific config file
TGMANAGER_CONFIG=/secure/location/.env ./tgmanager-linux -a account2 -c upload -i @channel -f file.pdf
```

### Portable Usage
```bash
# Place .env next to executable for portable setup
cp ~/.tgmanager/.env /path/to/usb/
cp tgmanager-linux /path/to/usb/
cd /path/to/usb
./tgmanager-linux -a myaccount -c create -n "New Channel"
```

## Troubleshooting

### No Credentials Found
If you see "No accounts configured", check:
1. Your `.env` file exists in one of the expected locations
2. The file has correct permissions (readable by your user)
3. Environment variable names match the expected format

### View Config Locations
The executable will log where it loaded the config from:
```
[2024-01-01 12:00:00] [info]: Configuration loaded from: /home/user/.tgmanager/.env
```

### Sessions Directory
By default, standalone executables use:
- Development: `./sessions` (in project directory)
- Standalone: `~/.tgmanager/sessions` (in home directory)

You can override this with `SESSION_DIR` in your `.env` file.

## Migration from Hardcoded Credentials

If you previously used `accounts.js`, migrate to `.env`:

1. Create `~/.tgmanager/.env` with your credentials
2. Delete old `accounts.js`
3. Use the same account names in commands

The standalone executables are now more secure and flexible, supporting multiple configuration methods without embedding credentials.