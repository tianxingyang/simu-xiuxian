import { format } from 'node:util';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let _minLevel = LEVELS.info;
let _processTag = '';

export function initLogger(opts: { level?: LogLevel; tag?: string } = {}): void {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  _minLevel = LEVELS[opts.level ?? (envLevel && envLevel in LEVELS ? envLevel : 'info')];
  if (opts.tag) _processTag = opts.tag;
}

function ts(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(11, 19);
}

function write(stream: NodeJS.WritableStream, tag: string, args: unknown[]): void {
  const parts: string[] = [ts()];
  if (_processTag) parts.push(`[${_processTag}]`);
  if (tag) parts.push(`[${tag}]`);
  parts.push(format(...args));
  stream.write(parts.join(' ') + '\n');
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function getLogger(tag = ''): Logger {
  return {
    debug(...args) { if (_minLevel <= LEVELS.debug) write(process.stdout, tag, args); },
    info(...args) { if (_minLevel <= LEVELS.info) write(process.stdout, tag, args); },
    warn(...args) { if (_minLevel <= LEVELS.warn) write(process.stderr, tag, args); },
    error(...args) { if (_minLevel <= LEVELS.error) write(process.stderr, tag, args); },
  };
}
