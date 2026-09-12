// Routes gramjs's internal logging through winston.
//
// gramjs ships its own Logger that writes straight to console.log in a format
// unlike ours. Two problems follow: its lines interleave with an active
// cli-progress bar and corrupt the render, and they never reach the log files.
//
// Every level method (info/warn/debug/error) funnels through `_log`, which
// applies the level filter and then calls `log` to emit. Overriding `log` is
// therefore the single interception point that catches all of them while
// leaving gramjs's own level filtering intact.
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import logger from '../logger.js';

/** Levels gramjs understands. Anything else breaks its canSend() lookup. */
const GRAMJS_LEVELS: readonly string[] = [
  LogLevel.NONE,
  LogLevel.ERROR,
  LogLevel.WARN,
  LogLevel.INFO,
  LogLevel.DEBUG,
];

/**
 * Translate a configured winston level to the nearest gramjs level.
 *
 * winston defines levels gramjs does not (verbose, http, silly); passing one
 * through would make gramjs's canSend() index lookup return -1 and silently
 * drop every message.
 */
function toGramjsLevel(winstonLevel: string): LogLevel {
  return (GRAMJS_LEVELS.includes(winstonLevel) ? winstonLevel : LogLevel.INFO) as LogLevel;
}

/**
 * A gramjs Logger that forwards to winston instead of writing to the console.
 *
 * Levels are mapped straight across rather than demoted: this is a routing
 * change, not a filtering one, so the same messages appear as before — just
 * formatted consistently and captured in the log files.
 */
class WinstonBackedGramjsLogger extends Logger {
  /**
   * The sole emit path for every gramjs log call. `color` is dropped because
   * winston applies its own colourisation per transport.
   */
  override log(level: LogLevel, message: string, _color: string): void {
    const meta = { source: 'gramjs' };

    switch (level) {
      case LogLevel.ERROR:
        logger.error(message, meta);
        break;
      case LogLevel.WARN:
        logger.warn(message, meta);
        break;
      case LogLevel.DEBUG:
        logger.debug(message, meta);
        break;
      default:
        logger.info(message, meta);
    }
  }
}

/** Build the logger to hand to TelegramClient as `baseLogger`. */
export function createGramjsLogger(winstonLevel: string): Logger {
  return new WinstonBackedGramjsLogger(toGramjsLevel(winstonLevel));
}
