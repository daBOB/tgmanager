// src/utils/directory-walker.ts
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

export interface DirectoryEntry {
  absolutePath: string;
  relativePath: string;
}

/**
 * Recursively walk a directory and return all files (skipping hidden entries).
 * Uses Node 22 recursive readdir — no external dependencies.
 * @param dirPath - Absolute path to directory
 * @returns Array of file entries sorted by relative path
 */
export async function walkDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true, recursive: true });

  const files: DirectoryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // parentPath is absolute in Node's recursive readdir — make it relative to dirPath
    const relParent = entry.parentPath ? relative(dirPath, entry.parentPath) : '';
    const relativePath = relParent ? join(relParent, entry.name) : entry.name;

    // Skip if any path segment starts with '.'
    const segments = relativePath.split('/');
    if (segments.some(seg => seg.startsWith('.'))) continue;

    files.push({
      absolutePath: join(dirPath, relativePath),
      relativePath,
    });
  }

  // Sort for deterministic queue ordering
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return files;
}
