import { buildCliOptions } from './cli/cli-parser.js';
import { dispatch } from './cli/command-dispatcher.js';

const main = async (): Promise<void> => {
  const options = buildCliOptions();
  await dispatch(options);
};

main();