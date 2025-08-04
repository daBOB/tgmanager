# TGManager - Telegram File Upload Manager

A secure, efficient command-line tool for managing file uploads to Telegram channels with multi-account support.

## Features

- 📁 **Bulk file uploads** - Upload single files or entire directories
- 👥 **Multi-account support** - Manage multiple Telegram accounts
- 🔄 **Automatic retry** - Handles rate limits with exponential backoff
- 📊 **Progress tracking** - Real-time upload progress bars
- 🖼️ **Smart image processing** - Automatic resizing for Telegram limits
- 🎥 **Video optimization** - MP4 files with proper metadata
- 🔒 **Secure configuration** - Environment-based credential management
- 📝 **Comprehensive logging** - Detailed logs with rotation
- ✅ **Input validation** - Secure path handling and validation

## Installation

### Prerequisites

- Node.js 18 or higher
- FFmpeg (for video processing)
- Sharp dependencies (automatic installation)
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

## Usage

### Basic Commands

For development (with TypeScript):
```bash
npm run dev -- -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

For production (compiled JavaScript):
```bash
npm start -- -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

Upload a single file:
```bash
node dist/index.js -a your_account -c upload -i @channel_username -f /path/to/file.mp4
```

Upload a directory:
```bash
node dist/index.js -a your_account -c upload -i @channel_username -f /path/to/directory/
```

Create a new channel:
```bash
node dist/index.js -a your_account -c create -n "My New Channel"
```

### Command Options

| Option | Description | Required |
|--------|-------------|----------|
| `-a, --account <name>` | Account name from config | Yes |
| `-c, --command <cmd>` | Command to execute (upload, create) | Yes |
| `-i, --chat-id <id>` | Chat ID or @username | For upload |
| `-f, --file-path <path>` | File or directory path | For upload |
| `-n, --name <name>` | Channel name | For create |
| `--delete-source` | Delete files after successful upload | No |

### Examples

Upload with source deletion:
```bash
node dist/index.js -a myaccount -c upload -i @mychannel -f video.mp4 --delete-source
```

Upload to a specific chat ID:
```bash
node dist/index.js -a myaccount -c upload -i -1001234567890 -f document.pdf
```

Development mode with hot reload:
```bash
npm run dev -- -a myaccount -c upload -i @mychannel -f test.jpg
```

## File Processing

### Supported File Types

- **Videos**: MP4 files with automatic metadata extraction
- **Images**: JPG, JPEG, PNG, GIF with automatic resizing
- **Documents**: All other file types

### Size Limits

- **Regular accounts**: 2 GB per file
- **Premium accounts**: 4 GB per file
- **Image dimensions**: Max 5000x5000 pixels

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

# Start production version
npm start
```

## Building Binaries

Build TypeScript and create binaries for all platforms:
```bash
npm run build
```

Build for specific platform:
```bash
# First build TypeScript
npm run build:ts

# Then package for your platform
# Windows
pkg dist/index.js --target node18-win-x64 --output dist/tgmanager.exe

# macOS
pkg dist/index.js --target node18-macos-x64 --output dist/tgmanager

# Linux
pkg dist/index.js --target node18-linux-x64 --output dist/tgmanager
```

### Using Standalone Executables

The compiled executables support multiple configuration methods:

1. **Environment file** (`.env`) in multiple locations
2. **System environment variables**
3. **Custom config path** via `TGMANAGER_CONFIG`

See [STANDALONE.md](STANDALONE.md) for detailed instructions on using standalone executables with credentials.

## Docker Support

Build the Docker image:
```bash
docker build -t tgmanager .
```

Run with Docker:
```bash
docker run -v ~/.tgmanager:/root/.tgmanager tgmanager -a account -c upload -i @channel -f /path/to/file
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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Technology Stack

- **Language**: TypeScript with ES modules
- **Runtime**: Node.js 18+
- **Type Safety**: Full TypeScript support with strict mode
- **Telegram API**: [GramJS](https://github.com/gram-js/gramjs)
- **Image Processing**: [Sharp](https://sharp.pixelplumbing.com/)
- **Video Processing**: [FFmpeg](https://ffmpeg.org/)
- **Logging**: Winston with rotation
- **CLI**: Commander.js

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