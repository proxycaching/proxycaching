import fs from 'fs';
import path from 'path';

export interface CacheRuleMatch {
  method?: string[];
  domains?: string[];
  paths?: string[];
  headers?: Record<string, string>;
  query?: Record<string, string>;
  // Optional body pattern to match request body. Supports '*' or wildcard patterns.
  body?: string;
}

export interface CacheRule {
  name: string;
  match: CacheRuleMatch;
  cache: boolean;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm: string;
  keyEnvVar: string;
}

export interface ProxyConfig {
  port: number;
  adminPort: number;
  podcachePath: string;
  adminEnabled: boolean;
  mitmEnabled?: boolean;
  encryption: EncryptionConfig;
  logging: {
    level: string;
  };
}

export interface AppConfig {
  proxy: ProxyConfig;
  rules: CacheRule[];
}

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'config.json');
export const CONFIG_DIR = path.dirname(CONFIG_PATH);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRuleMatch(value: unknown): CacheRuleMatch {
  assert(isRecord(value), 'Rule match must be an object.');

  const match: CacheRuleMatch = {};

  if ('method' in value) {
    assert(Array.isArray(value.method), 'Rule match.method must be an array.');
    match.method = value.method.map((entry) => String(entry));
  }

  if ('domains' in value) {
    assert(Array.isArray(value.domains), 'Rule match.domains must be an array.');
    match.domains = value.domains.map((entry) => String(entry));
  }

  if ('paths' in value) {
    assert(Array.isArray(value.paths), 'Rule match.paths must be an array.');
    match.paths = value.paths.map((entry) => String(entry));
  }

  if ('headers' in value) {
    assert(isRecord(value.headers), 'Rule match.headers must be an object.');
    match.headers = Object.fromEntries(
      Object.entries(value.headers).map(([key, val]) => [key.toLowerCase(), String(val)])
    );
  }

  if ('query' in value) {
    assert(isRecord(value.query), 'Rule match.query must be an object.');
    match.query = Object.fromEntries(
      Object.entries(value.query).map(([key, val]) => [key, String(val)])
    );
  }

  if ('body' in value) {
    assert(typeof (value as any).body === 'string', 'Rule match.body must be a string.');
    match.body = String((value as any).body);
  }

  return match;
}

export function validateCacheRule(value: unknown): CacheRule {
  assert(isRecord(value), 'Rule must be an object.');
  assert(typeof value.name === 'string' && value.name.length > 0, 'Rule requires a name.');
  assert('match' in value, `Rule ${String((value as any).name)} requires a match object.`);
  assert(typeof value.cache === 'boolean', `Rule ${String((value as any).name)} requires a boolean cache property.`);

  return {
    name: String((value as any).name),
    match: validateRuleMatch((value as any).match),
    cache: (value as any).cache,
  };
}

function validateRules(value: unknown): CacheRule[] {
  assert(Array.isArray(value), 'Rules must be an array.');

  return value.map((item, index) => {
    assert(isRecord(item), `Rule at index ${index} must be an object.`);
    assert(typeof item.name === 'string' && item.name.length > 0, `Rule at index ${index} requires a name.`);
    assert('match' in item, `Rule ${item.name} requires a match object.`);
    assert(typeof item.cache === 'boolean', `Rule ${item.name} requires a boolean cache property.`);

    return {
      name: item.name,
      match: validateRuleMatch(item.match),
      cache: item.cache,
    };
  });
}

function validateEncryptionConfig(value: unknown): EncryptionConfig {
  assert(isRecord(value), 'Encryption config must be an object.');
  assert(typeof value.enabled === 'boolean', 'Encryption enabled flag must be boolean.');
  assert(typeof value.algorithm === 'string', 'Encryption algorithm must be a string.');
  assert(typeof value.keyEnvVar === 'string', 'Encryption keyEnvVar must be a string.');

  return {
    enabled: value.enabled,
    algorithm: value.algorithm,
    keyEnvVar: value.keyEnvVar,
  };
}

function validateProxyConfig(value: unknown): ProxyConfig {
  assert(isRecord(value), 'Proxy config must be an object.');
  assert(typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0, 'Proxy port must be a positive integer.');
  assert(typeof value.adminPort === 'number' && Number.isInteger(value.adminPort) && value.adminPort > 0, 'Admin port must be a positive integer.');
  assert(typeof value.podcachePath === 'string' && value.podcachePath.length > 0, 'podcachePath must be a non-empty string.');
  assert(typeof value.adminEnabled === 'boolean', 'adminEnabled must be boolean.');
  if ('mitmEnabled' in value) {
    assert(typeof value.mitmEnabled === 'boolean', 'mitmEnabled must be boolean.');
  }
  assert(isRecord(value.logging), 'Logging config must be an object.');
  assert(typeof value.logging.level === 'string', 'Logging level must be a string.');

  return {
    port: value.port,
    adminPort: value.adminPort,
    podcachePath: path.resolve(path.dirname(CONFIG_PATH), '..', value.podcachePath),
    adminEnabled: value.adminEnabled,
    mitmEnabled: (value as any).mitmEnabled ?? false,
    encryption: validateEncryptionConfig(value.encryption),
    logging: {
      level: value.logging.level,
    },
  };
}

export function loadConfig(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  assert(isRecord(parsed), 'Top-level config must be an object.');
  assert('proxy' in parsed, 'Configuration must contain proxy settings.');
  assert('rules' in parsed, 'Configuration must contain rules array.');

  const config: AppConfig = {
    proxy: validateProxyConfig(parsed.proxy),
    rules: validateRules(parsed.rules),
  };

  return config;
}

export function saveConfig(config: AppConfig): void {
  const output = JSON.stringify({ proxy: config.proxy, rules: config.rules }, null, 2);
  fs.writeFileSync(CONFIG_PATH, output, 'utf-8');
}
