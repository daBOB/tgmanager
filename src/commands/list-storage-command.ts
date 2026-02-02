// src/commands/list-storage-command.ts
import type { TelegramClient } from '../types/index.js';
import { StorageService, StoredFileInfo } from '../storage/storage-service.js';
import logger from '../logger.js';

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

  console.log('\nFetching storage contents...\n');

  try {
    const files = pathPrefix
      ? await storage.listByPath(pathPrefix)
      : await storage.listStoredFiles();

    if (files.length === 0) {
      console.log('No files found in storage.');
      if (pathPrefix) {
        console.log(`(filtered by path: ${pathPrefix})`);
      }
      return true;
    }

    // Sort by virtual path
    files.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath));

    // Group by directory
    const grouped = groupByDirectory(files);

    console.log(`Found ${files.length} file(s):\n`);

    for (const [dir, dirFiles] of Object.entries(grouped)) {
      console.log(`📁 ${dir || '/'}`);
      for (const file of dirFiles) {
        const status = file.status === 'complete' ? '✓' : '⚠';
        const size = formatBytes(file.size);
        console.log(`   ${status} ${file.originalName} (${size})`);
      }
      console.log('');
    }

    // Summary
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`Total: ${files.length} files, ${formatBytes(totalSize)}`);

    return true;
  } catch (error) {
    logger.error('Failed to list storage', { error: (error as Error).message });
    console.error(`Error: ${(error as Error).message}`);
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

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
