// User-facing CLI output.
//
// Deliberately separate from the winston logger: log records are diagnostics
// that also go to rotating files, whereas this is the text the person who ran
// the command reads. Routing it through one module keeps stdout/stderr choices
// in a single place and gives tests something to intercept.
//
// This is the only module permitted to call `console` directly (see eslint.config.js).

/** Write a line to stdout. Call with no argument for a blank line. */
export function print(message = ''): void {
  console.log(message);
}

/** Write a line to stderr. Use for failures the user must see. */
export function printError(message: string): void {
  console.error(message);
}
