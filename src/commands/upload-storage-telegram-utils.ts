// src/commands/upload-storage-telegram-utils.ts
// Telegram-specific utilities: premium status check and byte formatter
import { Api } from 'telegram';
import type { TelegramClient } from '../types/index.js';

/** Check if authenticated user has Telegram Premium */
export async function checkPremiumStatus(client: TelegramClient): Promise<boolean> {
  try {
    const result = await client.invoke(
      new Api.users.GetFullUser({ id: 'Me' })
    );
    const user = result.users?.[0] as any;
    return !!user?.premium;
  } catch {
    return false;
  }
}

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
