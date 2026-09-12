// Routes an authenticated command to its handler.
//
// Every handler returns a process exit code rather than calling process.exit
// itself, so the caller can still run its cleanup (process.exit skips `finally`
// blocks) and so handlers stay testable.
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';
import logger from '../logger.js';
import { sanitizeInput } from '../utils/validation.js';
import { runUploadCommand } from './upload-directory-command.js';
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
 * Dispatch a command that needs an authenticated client.
 * @returns process exit code
 */
export async function routeCommand(ctx: CommandContext): Promise<number> {
  const { client, account, options, uploadPath } = ctx;

  switch (options.command) {
    case 'upload': {
      if (!options.chatId || !uploadPath) return 1;
      return runUploadCommand(client, options.chatId, uploadPath, options);
    }

    case 'create':
      return createChannel(ctx);

    case 'upload-storage': {
      const { startWorker } = await import('../queue/queue-worker.js');
      const result = await startWorker(account, client);
      return result.failed > 0 ? 1 : 0;
    }

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
