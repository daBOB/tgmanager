// src/utils/directory-walker.ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface DirectoryEntry {
  absolutePath: string;
  relativePath: string;
}

/**
 * Recursively walk a directory and return all files (skipping hidden entries).
 * Manual recursion for Node 18 pkg compat — readdir({ recursive }) and
 * Dirent.parentPath are unreliable in pkg-bundled Node 18 runtimes.
 * @param dirPath - Absolute path to directory
 * @returns Array of file entries sorted by relative path
 */
export async function walkDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  const files: DirectoryEntry[] = [];
  await walkRecursive(dirPath, '', files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function walkRecursive(basePath: string, relDir: string, out: DirectoryEntry[]): Promise<void> {
  const currentDir = relDir ? join(basePath, relDir) : basePath;
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files/directories
    if (entry.name.startsWith('.')) continue;

    const relativePath = relDir ? join(relDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await walkRecursive(basePath, relativePath, out);
    } else if (entry.isFile()) {
      out.push({
        absolutePath: join(basePath, relativePath),
        relativePath,
      });
    }
  }
}
