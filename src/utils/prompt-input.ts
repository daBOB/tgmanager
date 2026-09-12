import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Read a single line of input from the terminal.
 *
 * The readline interface is created per call and always closed again: an open
 * interface keeps a listener on stdin, which would stop the process from
 * exiting once the CLI is done. Callers may prompt several times (Telegram
 * retries the login code on a bad entry), so setup cost is paid per prompt
 * rather than held open for the lifetime of the process.
 */
export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}
