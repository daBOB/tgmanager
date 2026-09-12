// Routes an authenticated command to its handler.
//
// Every handler returns a process exit code rather than calling process.exit
// itself, so the caller can still run its cleanup (process.exit skips `finally`
// blocks) and so handlers stay testable.
import { rmSync, statSync } from 'node:fs';
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import logger from '../logger.js';
import { sanitizeInput } from '../utils/validation.js';
import type { CommandOptions } from '../types/index.js';

export interface CommandContext {
  client: TelegramClient;
  account: string;
  options: CommandOptions;
  /** Absolute source path, when the command takes one. */
  uploadPath?: string;
}

/** Create a broadcast channel and log its ID. */
async function createChannel(ctx: CommandContext): Promise<number> {
  const sanitizedName = sanitizeInput(ctx.options.name ?? '');

  const result = await ctx.client.invoke(
    new Api.channels.CreateChannel({
      title: sanitizedName,
      about: '',
      broadcast: true,
      megagroup: false,
    })
  );

  const chats = (result as { chats?: Api.Chat[] }).chats;
  if (!chats || chats.length === 0) {
    throw new Error('Failed to create channel: no channel data returned');
  }

  const channel = chats[0] as unknown as Api.Channel;
  const channelId = `-100${channel.id.toJSNumber()}`;
  logger.info('Channel created successfully', { channelId, name: sanitizedName });
  return 0;
}

/**
 * Remove the source directory once its files are gone.
 *
 * The direct upload path deleted the directory only when every file succeeded.
 * Per-file deletion now happens in the worker, so the same condition is
 * expressed by attempting a non-recursive remove: it succeeds exactly when
 * nothing is left, and fails harmlessly while any file remains — whether that
 * file failed, was skipped, or is still queued for another worker.
 */
function removeEmptySourceDirectory(uploadPath: string): void {
  if (!statSync(uploadPath).isDirectory()) return;

  try {
    rmSync(uploadPath, { recursive: false });
    logger.info('Deleted source directory', { path: uploadPath });
  } catch (error) {
    logger.info('Source directory kept: not empty', {
      path: uploadPath,
      reason: (error as Error).message,
    });
  }
}

/**
 * Dispatch a command that needs an authenticated client.
 * @returns process exit code
 */
export async function routeCommand(ctx: CommandContext): Promise<number> {
  const { client, account, options, uploadPath } = ctx;

  switch (options.command) {
    // Both upload kinds are queued before the lock is taken, so the work here
    // is the same: drain whatever this account has waiting.
    case 'upload':
    case 'upload-storage': {
      const { startWorker } = await import('../queue/queue-worker.js');
      const result = await startWorker(account, client);
      if (options.command === 'upload' && options.deleteSource && uploadPath) {
        removeEmptySourceDirectory(uploadPath);
      }
      return result.failed > 0 ? 1 : 0;
    }

    case 'create':
      return createChannel(ctx);

    case 'download-storage': {
      if (!options.virtualPath) return 1;
      const { downloadStorageCommand } = await import('../commands/download-storage-command.js');
      const success = await downloadStorageCommand(client, {
        virtualPath: options.virtualPath,
        outputPath: options.outputPath,
        storageChannelId: options.storageChannel,
        force: options.force,
      });
      return success ? 0 : 1;
    }

    case 'list-storage': {
      const { listStorageCommand } = await import('../commands/list-storage-command.js');
      const success = await listStorageCommand(client, {
        pathPrefix: options.virtualPath,
        storageChannelId: options.storageChannel,
      });
      return success ? 0 : 1;
    }

    default:
      logger.error('No handler for command', { command: options.command });
      return 1;
  }
}
