#!/bin/bash
# Safe uploader wrapper script with process locking
# This script prevents multiple instances from running with the same account

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPLOADER_BIN="${SCRIPT_DIR}/dist/uploader-linux"

# Check if uploader binary exists
if [ ! -f "$UPLOADER_BIN" ]; then
    echo -e "${RED}Error: Uploader binary not found at $UPLOADER_BIN${NC}"
    echo "Please build the project first: npm run build-native"
    exit 1
fi

# Make sure binary is executable
chmod +x "$UPLOADER_BIN"

# Parse account name from arguments
ACCOUNT=""
for ((i=1; i<=$#; i++)); do
    if [ "${!i}" = "-a" ] || [ "${!i}" = "--account" ]; then
        j=$((i+1))
        ACCOUNT="${!j}"
        break
    fi
done

if [ -z "$ACCOUNT" ]; then
    echo -e "${RED}Error: Account name not specified${NC}"
    echo "Usage: $0 -a ACCOUNT_NAME [other options]"
    exit 1
fi

# Lock file location
LOCK_DIR="$HOME/.tgmanager/locks"
LOCK_FILE="$LOCK_DIR/${ACCOUNT}.lock"

# Create lock directory
mkdir -p "$LOCK_DIR"

# Function to cleanup lock file
cleanup() {
    if [ -f "$LOCK_FILE" ]; then
        rm -f "$LOCK_FILE"
        echo -e "${GREEN}✓ Cleanup complete${NC}"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Check for existing lock
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${RED}Error: Another instance is already running with account '$ACCOUNT' (PID: $PID)${NC}"
        echo ""
        echo "Options:"
        echo "  1. Wait for the other instance to finish"
        echo "  2. Stop the other instance: kill $PID"
        echo "  3. Force remove lock (if process is stuck): rm $LOCK_FILE"
        exit 1
    else
        echo -e "${YELLOW}Warning: Removing stale lock file${NC}"
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock with current PID
echo $$ > "$LOCK_FILE"
echo -e "${GREEN}✓ Lock acquired for account '$ACCOUNT'${NC}"

# Run the uploader with all arguments
echo -e "${GREEN}Starting upload...${NC}"
"$UPLOADER_BIN" "$@"
EXIT_CODE=$?

# Cleanup is handled by trap
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Upload completed successfully${NC}"
else
    echo -e "${RED}✗ Upload failed with exit code $EXIT_CODE${NC}"
fi

exit $EXIT_CODE

