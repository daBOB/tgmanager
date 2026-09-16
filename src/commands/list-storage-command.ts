// src/commands/list-storage-command.ts
import type { TelegramClient } from '../types/index.js';
import type { StoredFileInfo } from '../storage/storage-service.js';
import { StorageService } from '../storage/storage-service.js';
import logger from '../logger.js';
import { print, printError } from '../utils/console-output.js';
import { formatBytes } from '../utils/format-bytes.js';

export interface ListStorageOptions {
  pathPrefix?: string;
  storageChannelId?: string;
}

/**
 * List files stored in Telegram storage channel
 */
export async function listStorageCommand(
  client: TelegramClient,
  options: ListStorageOptions
): Promise<boolean> {
  const { pathPrefix, storageChannelId } = options;

  // Initialize storage service
  const storage = new StorageService(client, { storageChannelId });
  await storage.initializeStorageChannel();

  print('\nFetching storage contents...\n');

  try {
    const files = pathPrefix
      ? await storage.listByPath(pathPrefix)
      : await storage.listStoredFiles();

    if (files.length === 0) {
      print('No files found in storage.');
      if (pathPrefix) {
        print(`(filtered by path: ${pathPrefix})`);
      }
      return true;
    }

    // Sort by virtual path
    files.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));

    // Group by directory
    const grouped = groupByDirectory(files);

    print(`Found ${files.length} file(s):\n`);

    for (const [dir, dirFiles] of Object.entries(grouped)) {
      print(`📁 ${dir || '/'}`);
      for (const file of dirFiles) {
        const status = file.status === 'complete' ? '✓' : '⚠';
        const size = formatBytes(file.size);
        print(`   ${status} ${file.originalName} (${size})`);
      }
      print('');
    }

    // Summary
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    print(`Total: ${files.length} files, ${formatBytes(totalSize)}`);

    return true;
  } catch (error) {
    logger.error('Failed to list storage', { error: (error as Error).message });
    printError(`Error: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Group files by their directory path
 */
function groupByDirectory(files: StoredFileInfo[]): Record<string, StoredFileInfo[]> {
  const grouped: Record<string, StoredFileInfo[]> = {};

  for (const file of files) {
    const parts = file.virtualPath.split('/');
    parts.pop(); // Remove filename
    const dir = parts.join('/') || '/';

    if (!grouped[dir]) {
      grouped[dir] = [];
    }
    grouped[dir].push(file);
  }

  return grouped;
}

