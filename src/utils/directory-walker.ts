// src/utils/directory-walker.ts
import { readdir } from 'fs/promises';
import { join } from 'path';
import { statSync } from 'fs';

export interface DirectoryEntry {
  absolutePath: string;
  relativePath: string;
}

/**
 * Recursively walk a directory and return all files (skipping hidden entries).
 * Uses readdir({ recursive: true }) without withFileTypes for Node 18 compat
 * (Dirent.parentPath only exists in Node 20.12+, but binary targets Node 18).
 * @param dirPath - Absolute path to directory
 * @returns Array of file entries sorted by relative path
 */
export async function walkDirectory(dirPath: string): Promise<DirectoryEntry[]> {
  // Returns string[] of relative paths (files + dirs) when recursive + no withFileTypes
  const allPaths = await readdir(dirPath, { recursive: true }) as string[];

  const files: DirectoryEntry[] = [];

  for (const relativePath of allPaths) {
    // Skip if any path segment starts with '.'
    const segments = relativePath.split('/');
    if (segments.some(seg => seg.startsWith('.'))) continue;

    const absolutePath = join(dirPath, relativePath);

    // Only include files (not directories)
    if (!statSync(absolutePath).isFile()) continue;

    files.push({ absolutePath, relativePath });
  }

  // Sort for deterministic queue ordering
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return files;
}
