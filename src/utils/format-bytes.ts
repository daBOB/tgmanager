// src/utils/format-bytes.ts
// Shared presentation helper: one byte formatter for every caller that shows
// a file size, so precision and units cannot drift between them.

/** Format bytes to human-readable string (e.g. 1.50 MB) */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}
