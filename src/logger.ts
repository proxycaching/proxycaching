export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function formatMessage(level: string, args: unknown[]): string {
  const time = new Date().toISOString();
  const message = args.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    try {
      return JSON.stringify(item, null, 2);
    } catch {
      return String(item);
    }
  });

  return `[${time}] [${level.toUpperCase()}] ${message.join(' ')}.`;
}

export function createLogger(level: string): Logger {
  const normalized = String(level || 'info').toLowerCase() as LogLevel;
  const effectiveLevel = levelPriority[normalized] ? normalized : 'info';
  const minPriority = levelPriority[effectiveLevel];

  function buildLogger(method: LogLevel): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      if (levelPriority[method] >= minPriority) {
        const output = formatMessage(method, args);
        if (method === 'error') {
          console.error(output);
        } else if (method === 'warn') {
          console.warn(output);
        } else {
          console.log(output);
        }
      }
    };
  }

  return {
    debug: buildLogger('debug'),
    info: buildLogger('info'),
    warn: buildLogger('warn'),
    error: buildLogger('error'),
  };
}
