import { buildCliOptions } from './cli/cli-parser.js';
import { dispatch } from './cli/command-dispatcher.js';
import { printError } from './utils/console-output.js';
import { installShutdownNoiseFilter } from './utils/telegram-shutdown-noise.js';

// The single place the process exits. Handlers return exit codes so their
// cleanup (and `finally` blocks) run — process.exit skips those.
const main = async (): Promise<void> => {
  installShutdownNoiseFilter();
  const options = buildCliOptions();
  process.exitCode = await dispatch(options);
};

main().catch((error: unknown) => {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
