# TGManager - Telegram File Upload Manager

A secure, efficient command-line tool for managing file uploads to Telegram channels with multi-account support.

## Features

- **Bulk file uploads** - Upload single files or entire directories to channels
- **Telegram storage** - Store, download, and list files using a Telegram channel as cloud storage with automatic file splitting for large files
- **Multi-account support** - Manage multiple Telegram accounts
- **Automatic retry** - Handles rate limits and flood waits with exponential backoff
- **Progress tracking** - Real-time upload/download progress bars
- **Smart image processing** - Automatic resizing for Telegram dimension limits
- **Video optimization** - MP4 files with proper metadata extraction
- **Resume support** - Interrupted storage uploads can be resumed
- **Secure configuration** - Environment-based credential management with session file protection
- **Comprehensive logging** - Detailed logs with rotation
- **Input validation** - Secure path handling, sanitization, and validation
- **Process locking** - Prevents multiple instances from running with the same account

## Installation

### Prerequisites

- Node.js 22 or higher
- FFmpeg (for video processing)
- Sharp dependencies (automatic with `npm install`)
- TypeScript (installed as dev dependency)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/tgmanager.git
cd tgmanager
```

2. Install dependencies:
```bash
npm install
```

3. Create your environment file:
```bash
cp .env.example .env
```

4. Edit `.env` with your Telegram credentials:
```env
# Account: your_account_name
YOUR_ACCOUNT_API_ID=123456
YOUR_ACCOUNT_API_HASH=your_api_hash_here
YOUR_ACCOUNT_PHONE=+1234567890
YOUR_ACCOUNT_PASSWORD=your_password_here
```

5. Build the TypeScript code:
```bash
npm run build:ts
```

## Configuration

### Getting Telegram API Credentials

1. Visit https://my.telegram.org
2. Log in with your phone number
3. Go to "API Development Tools"
4. Create a new application
5. Copy your `api_id` and `api_hash`

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (error, warn, info, debug) | `info` |
| `MAX_CONCURRENT_UPLOADS` | Number of concurrent uploads | `1` |
| `UPLOAD_TIMEOUT` | Upload timeout in milliseconds | `600000` |
| `SESSION_DIR` | Directory for session storage | `sessions` (in project) |
| `UPLOAD_DIR` | Default upload directory | `uploads` (in project) |
| `TGMANAGER_CONFIG` | Path to a custom `.env` file | Auto-detected |
| `TGMANAGER_HOME` | Base directory for sessions and config | Project directory / `~/.tgmanager` |
| `TGMANAGER_DEFAULT_ACCOUNT` | Default account name (skip `-a` flag) | None |

## Usage

### Shorthand Syntax

Set a default account to skip the `-a` flag:
```bash
export TGMANAGER_DEFAULT_ACCOUNT=myaccount
```

Use short command aliases with positional arguments:
```bash
# Upload to storage (store = upload-storage)
./uploader-linux store /path/to/file.zip /backups/file.zip

# Download from storage (get = download-storage)
./uploader-linux get /backups/file.zip --output-path ./restored.zip

# List storage files (ls = list-storage)
./uploader-linux ls /backups/

# Aliases work with flags too
./uploader-linux store /path/to/file.zip /backups/file.zip --delete-source --wait
```

All original flag-based syntax remains fully supported.

### Running the Application

For development (with TypeScript via tsx):
```bash
npm run dev -- -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

For production (compiled JavaScript):
```bash
npm start -- -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

Or using standalone binaries (see [Building Binaries](#building-binaries)):
```bash
./uploader-linux -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

### Commands

#### `upload` - Upload files to a channel

Upload a single file:
```bash
node dist/index.js -a myaccount -c upload -i @mychannel -f /path/to/file.mp4
```

Upload a directory (all files uploaded concurrently):
```bash
node dist/index.js -a myaccount -c upload -i @mychannel -f /path/to/directory/
```

Upload with source deletion after success:
```bash
node dist/index.js -a myaccount -c upload -i @mychannel -f video.mp4 --delete-source
```

Upload to a specific chat ID:
```bash
node dist/index.js -a myaccount -c upload -i -1001234567890 -f document.pdf
```

#### `create` - Create a new Telegram channel

```bash
node dist/index.js -a myaccount -c create -n "My New Channel"
```

#### `upload-storage` - Upload a file to Telegram storage

Uploads a file to a dedicated storage channel. Large files are automatically split into chunks. Files are identified by a virtual path (like a filesystem).

```bash
node dist/index.js -a myaccount -c upload-storage -f /path/to/largefile.zip --virtual-path /backups/largefile.zip
```

With a specific storage channel:
```bash
node dist/index.js -a myaccount -c upload-storage -f data.db --virtual-path /databases/data.db --storage-channel -1001234567890
```

#### `download-storage` - Download a file from Telegram storage

Downloads a previously stored file by its virtual path. Chunks are downloaded with retry logic and merged automatically.

```bash
node dist/index.js -a myaccount -c download-storage --virtual-path /backups/largefile.zip
```

Download to a specific location:
```bash
node dist/index.js -a myaccount -c download-storage --virtual-path /backups/largefile.zip --output-path /tmp/restored.zip
```

Force overwrite existing file:
```bash
node dist/index.js -a myaccount -c download-storage --virtual-path /backups/largefile.zip --force
```

#### `list-storage` - List files in Telegram storage

List all stored files:
```bash
node dist/index.js -a myaccount -c list-storage
```

Filter by virtual path prefix:
```bash
node dist/index.js -a myaccount -c list-storage --virtual-path /backups/
```

### CLI Options

| Option | Description | Required |
|--------|-------------|----------|
| `-a, --account <name>` | Account name from config | Yes |
| `-c, --command <cmd>` | Command to execute | Yes |
| `-i, --chat-id <id>` | Chat ID or @username | For `upload` |
| `-f, --file-path <path>` | File or directory path | For `upload`, `upload-storage` |
| `-n, --name <name>` | Channel name | For `create` |
| `--delete-source` | Delete files after successful upload | No |
| `--virtual-path <path>` | Virtual path for storage operations | For `upload-storage`, `download-storage` |
| `--output-path <path>` | Output path for downloads | For `download-storage` |
| `--storage-channel <id>` | Storage channel ID (auto-creates if omitted) | No |
| `--force` | Force overwrite existing files | No |

### Available Commands

| Command | Description |
|---------|-------------|
| `upload` | Upload files or directories to a Telegram channel |
| `create` | Create a new Telegram broadcast channel |
| `upload-storage` / `store` | Upload a file to Telegram storage with automatic splitting |
| `download-storage` / `get` | Download a file from Telegram storage by virtual path |
| `list-storage` / `ls` | List all files stored in Telegram storage |

## File Processing

### Supported File Types

- **Videos**: MP4 files with automatic metadata extraction (width, height, duration)
- **Images**: JPG, JPEG, PNG, GIF with automatic resizing when exceeding Telegram limits
- **Documents**: All other file types uploaded as-is

### Size Limits

| Account Type | Direct Upload Limit | Storage Upload |
|-------------|--------------------|----|
| Regular | 2 GB per file | Unlimited (auto-split) |
| Premium | 4 GB per file | Unlimited (auto-split) |

- **Image dimensions**: Max 5000x5000 pixels (auto-resized if exceeded)
- **Storage uploads**: Files exceeding the account limit are automatically split into chunks and reassembled on download

## Security Best Practices

1. **Never commit credentials** - Use environment variables
2. **Secure your .env file** - Set proper file permissions
3. **Use strong passwords** - Enable 2FA on Telegram
4. **Rotate API keys** - Regenerate periodically
5. **Monitor logs** - Check for unauthorized access

## Logging

Logs are stored in the `logs/` directory:
- `app.log` - All application logs
- `error.log` - Error logs only

Log rotation is automatic after 10MB.

## Development

### Available Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build:ts

# Type checking without building
npm run type-check

# Run ESLint
npm run lint

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Full build (TypeScript + native binaries + Docker)
npm run build

# Start production version
npm start
```

## Building Binaries

Binaries are compiled with Bun. Build all four targets:
```bash
bun run build-native
```

Build a single platform:
```bash
# linux-x64 (swap the target for bun-linux-arm64, bun-windows-x64, bun-darwin-x64)
bun build src/index.ts --compile --minify --target=bun-linux-x64 --outfile dist/uploader-linux
```

> **Image resizing is unavailable in the standalone binaries.** `bun build
> --compile` cannot embed native addons, so `sharp` does not load there and
> images are uploaded without resizing. Telegram rejects images beyond its
> dimension limits, so use the Docker image (`bun run build-docker`) or run from
> source if you upload oversized images.

### Using Standalone Executables

The compiled executables support multiple configuration methods:

1. **Environment file** (`.env`) in multiple locations
2. **System environment variables**
3. **Custom config path** via `TGMANAGER_CONFIG`

See [docs/standalone.md](docs/standalone.md) for detailed instructions on using standalone executables with credentials.

## Docker Support

Build the Docker image:
```bash
docker build -t tgmanager .
```

Run with Docker:
```bash
docker run -v ~/.tgmanager:/root/.tgmanager tgmanager -a account -c upload -i @channel -f /path/to/file
```

## Telegram Storage

The storage feature uses a dedicated Telegram channel as a file storage backend. Files are addressed by virtual paths (e.g., `/backups/db.sql`) and tracked via JSON manifests.

### How It Works

1. **Upload**: Files exceeding the Telegram size limit are split into chunks automatically. Each chunk is uploaded as a separate message. A manifest message tracks all chunks, checksums, and metadata.
2. **Download**: The manifest is fetched by virtual path, chunks are downloaded with retry logic and integrity verification (SHA-256), then merged back into the original file.
3. **List**: Searches the storage channel for manifest messages and displays stored files grouped by directory.

### Storage Channel

- If `--storage-channel` is not specified, TGManager auto-creates a channel named "TGManager Storage"
- The channel is reused across sessions (found by title)
- Do not delete the storage channel or its messages manually

### Resume Support

If a storage upload is interrupted, re-running the same command will skip already-uploaded chunks and resume from where it left off.

### Examples

Below are practical workflows for managing files with Telegram storage. All examples use `node dist/index.js` — replace with `./uploader-linux` (or `npm start --`) if using binaries or production mode.

#### Back up a database

```bash
# Upload today's database dump
node dist/index.js -a myaccount -c upload-storage \
  -f /var/backups/postgres-2026-02-05.sql.gz \
  --virtual-path /backups/db/postgres-2026-02-05.sql.gz

# List all database backups
node dist/index.js -a myaccount -c list-storage --virtual-path /backups/db/

# Restore a specific backup
node dist/index.js -a myaccount -c download-storage \
  --virtual-path /backups/db/postgres-2026-02-05.sql.gz \
  --output-path /tmp/restore.sql.gz
```

#### Store large video files and free disk space

```bash
# Upload a large video (auto-splits if it exceeds Telegram's limit)
node dist/index.js -a myaccount -c upload-storage \
  -f ~/Videos/recording-4k.mkv \
  --virtual-path /videos/recording-4k.mkv \
  --delete-source

# Verify it's stored
node dist/index.js -a myaccount -c list-storage --virtual-path /videos/

# Download it later on another machine
node dist/index.js -a myaccount -c download-storage \
  --virtual-path /videos/recording-4k.mkv \
  --output-path ~/Downloads/recording-4k.mkv
```

#### Organize project archives by folder

```bash
# Upload multiple project archives with a folder structure
node dist/index.js -a myaccount -c upload-storage \
  -f ./project-v1.tar.gz --virtual-path /archives/myapp/v1.0.0.tar.gz

node dist/index.js -a myaccount -c upload-storage \
  -f ./project-v2.tar.gz --virtual-path /archives/myapp/v2.0.0.tar.gz

# List only files under /archives/myapp/
node dist/index.js -a myaccount -c list-storage --virtual-path /archives/myapp/
```

#### Use a dedicated storage channel

By default, TGManager auto-creates a channel. If you want to use a specific channel (e.g., to separate personal and work storage):

```bash
# Upload to a specific channel
node dist/index.js -a myaccount -c upload-storage \
  -f ./report.pdf \
  --virtual-path /work/reports/q1-2026.pdf \
  --storage-channel -1001234567890

# List and download from the same channel
node dist/index.js -a myaccount -c list-storage \
  --storage-channel -1001234567890

node dist/index.js -a myaccount -c download-storage \
  --virtual-path /work/reports/q1-2026.pdf \
  --storage-channel -1001234567890
```

#### Resume an interrupted upload

```bash
# Start uploading a 10 GB file — gets interrupted at 60%
node dist/index.js -a myaccount -c upload-storage \
  -f ~/iso/ubuntu-server.iso \
  --virtual-path /iso/ubuntu-server.iso
# ^C (interrupted)

# Re-run the exact same command — skips already uploaded chunks
node dist/index.js -a myaccount -c upload-storage \
  -f ~/iso/ubuntu-server.iso \
  --virtual-path /iso/ubuntu-server.iso
# Resuming upload: 6/10 chunks already uploaded, uploading remaining 4...
```

#### Download and overwrite an existing file

```bash
# First download
node dist/index.js -a myaccount -c download-storage \
  --virtual-path /backups/db/latest.sql.gz \
  --output-path ./latest.sql.gz

# Download again — fails because file already exists
node dist/index.js -a myaccount -c download-storage \
  --virtual-path /backups/db/latest.sql.gz \
  --output-path ./latest.sql.gz
# Error: Output file already exists. Use --force to overwrite.

# Force overwrite
node dist/index.js -a myaccount -c download-storage \
  --virtual-path /backups/db/latest.sql.gz \
  --output-path ./latest.sql.gz \
  --force
```

## Troubleshooting

### Common Issues

1. **Authentication failed**
   - Check your API credentials
   - Ensure phone number format includes country code
   - Verify 2FA password if enabled

2. **File upload fails**
   - Check file size limits
   - Verify file permissions
   - Ensure sufficient disk space

3. **Rate limiting**
   - Tool handles this automatically
   - Increase flood wait multiplier in config if needed

4. **Session errors**
   - Delete session folder and re-authenticate
   - Check session directory permissions

5. **Storage download fails**
   - Verify the virtual path is correct with `list-storage`
   - Ensure the storage channel and its messages haven't been deleted
   - Use `--force` if the output file already exists

6. **Another instance already running**
   - A process lock prevents concurrent use of the same account
   - Wait for the other instance to finish, or check for stale lock files in the `locks/` directory

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Technology Stack

- **Language**: TypeScript 5.x with ES modules
- **Runtime**: Node.js 22+
- **Type Safety**: Full TypeScript support with strict mode
- **Telegram API**: [GramJS](https://github.com/gram-js/gramjs)
- **Image Processing**: [Sharp](https://sharp.pixelplumbing.com/)
- **Video Processing**: [FFmpeg](https://ffmpeg.org/)
- **Logging**: Winston with rotation
- **CLI**: Commander.js
- **Testing**: Vitest
- **Build**: Bun (`bun build --compile` for native binaries)

## Acknowledgments

- Built with [GramJS](https://github.com/gram-js/gramjs)
- Image processing by [Sharp](https://sharp.pixelplumbing.com/)
- Video processing with [FFmpeg](https://ffmpeg.org/)

## Project Data Storage

By default, all data is stored within the project directory:

- **Sessions**: `./sessions/` - Telegram session files
- **Uploads**: `./uploads/` - Default directory for files to upload
- **Logs**: `./logs/` - Application and error logs

You can customize these locations using environment variables to use absolute paths or different relative paths.

## Support

For issues and feature requests, please use the GitHub issue tracker.