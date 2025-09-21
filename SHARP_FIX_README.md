# Sharp Package Fix for Binary Distribution

## Problem
The `sharp` package was failing to load in the packaged binary with the error:
```
Cannot find package 'sharp' imported from /snapshot/tgmanager/dist-pkg/bundled.cjs
```

This is a common issue when using `pkg` to create standalone binaries with native modules like `sharp`.

## Root Cause
1. `sharp` is a native module with platform-specific binaries
2. The original build process marked `sharp` as external, expecting it to be available at runtime
3. In the pkg binary environment, external modules aren't accessible in the same way

## Solutions Implemented

### 1. Removed Sharp from External Dependencies
- Modified `scripts/bundle-for-pkg.cjs` to allow esbuild to bundle `sharp`
- This allows the sharp module to be included in the bundled output

### 2. Robust Sharp Loading with Fallbacks
- Created `src/utils/sharp-loader.ts` with multiple loading strategies:
  - Dynamic import (primary method)
  - CommonJS require (fallback)
  - Multiple path attempts (for different environments)
- Graceful degradation when sharp isn't available

### 3. Improved Error Handling
- Modified `src/Uploader.ts` to handle sharp loading failures gracefully
- Falls back to regular document upload when image processing isn't available
- Provides clear logging about what's happening

## Changes Made

### Files Modified:
1. `scripts/bundle-for-pkg.cjs` - Removed sharp from external dependencies
2. `src/Uploader.ts` - Updated to use robust sharp loader with fallbacks
3. `package.json` - Updated build script to use npx pkg
4. `src/utils/sharp-loader.ts` - New robust sharp loading utility

### Key Benefits:
- **Graceful Degradation**: App continues to work even if sharp fails to load
- **Better Logging**: Clear messages about what's happening with image processing
- **Multiple Fallbacks**: Several strategies to load sharp in different environments
- **Maintained Functionality**: Image processing still works when sharp is available

## Testing
The fix has been tested and the binary now:
1. Starts successfully without sharp errors
2. Provides helpful logging when sharp isn't available
3. Falls back to document upload for images when processing fails
4. Maintains full functionality when sharp loads successfully

## Usage
Use the rebuilt binaries as before:
```bash
./dist/uploader-linux -a account_name -c upload -i chat_id -f /path/to/images/
```

If sharp isn't available, you'll see a warning log message, but the upload will continue as a regular document upload instead of failing completely.
