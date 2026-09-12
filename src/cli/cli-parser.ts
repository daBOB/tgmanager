import { Command } from 'commander';
import { resolveCommandAlias, VALID_COMMANDS } from '../utils/validation.js';
import type { CommandOptions } from '../types/index.js';

/** Map positional arguments to named options based on resolved command. Explicit flags take priority. */
function applyPositionalArgs(opts: CommandOptions, command: string, args: string[]): void {
  switch (command) {
    case 'upload-storage':
      if (!opts.filePath && args.length >= 1) opts.filePath = args[0];
      if (!opts.virtualPath && args.length >= 2) opts.virtualPath = args[1];
      break;
    case 'download-storage':
      if (!opts.virtualPath && args.length >= 1) opts.virtualPath = args[0];
      break;
    case 'list-storage':
      if (!opts.virtualPath && args.length >= 1) opts.virtualPath = args[0];
      break;
  }
}

/** Build and parse CLI options from process.argv. Returns resolved CommandOptions. */
export function buildCliOptions(): CommandOptions {
  const program = new Command();

  program
    .option('-a, --account <account>', 'Account name (or set TGMANAGER_DEFAULT_ACCOUNT)')
    .option('-c, --command <command>', 'Command to execute')
    .option('-i, --chat-id <id>', 'Chat ID')
    .option('-f, --file-path <path>', 'File path')
    .option('-n, --name <name>', 'Name')
    .option('--delete-source', 'Delete the source file after the operation')
    .option('--virtual-path <path>', 'Virtual path for storage operations')
    .option('--output-path <path>', 'Output path for download operations')
    .option('--storage-channel <id>', 'Storage channel ID (optional)')
    .option('--force', 'Force overwrite existing files')
    .option('--wait', 'Wait for queued upload to complete')
    .option('--priority <n>', 'Queue priority; higher runs first (default 0)', Number)
    .option('--at <when>', 'Do not start the queued upload before this time (ISO 8601)')
    .option('--status <status>', 'Filter queue-status by job status')
    .option('--limit <n>', 'Maximum number of jobs to show', Number)
    .allowExcessArguments(true);

  program.parse(process.argv);

  const options = program.opts<CommandOptions>();
  const positionalArgs = program.args;

  // Resolve account: CLI flag > env var
  if (!options.account) {
    const defaultAccount = process.env.TGMANAGER_DEFAULT_ACCOUNT;
    if (defaultAccount) options.account = defaultAccount;
  }

  // Resolve command from positional args if -c not provided
  if (!options.command && positionalArgs.length > 0 && positionalArgs[0]) {
    const resolved = resolveCommandAlias(positionalArgs[0]);
    if (VALID_COMMANDS.includes(resolved)) {
      options.command = resolved;
      applyPositionalArgs(options, resolved, positionalArgs.slice(1));
    }
  } else if (options.command) {
    // Resolve alias on -c flag (e.g., -c store -> upload-storage)
    options.command = resolveCommandAlias(options.command);
    if (positionalArgs.length > 0) {
      applyPositionalArgs(options, options.command, positionalArgs);
    }
  }

  return options;
}
