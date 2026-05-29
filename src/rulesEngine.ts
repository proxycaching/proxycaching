import { CacheRule } from './config';

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) {
    return true;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i');
  return regex.test(value);
}

function listMatches(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => matchPattern(pattern, value));
}

function queryMatches(ruleQuery: Record<string, string> | undefined, requestQuery: Record<string, string | string[]>): boolean {
  if (!ruleQuery) {
    return true;
  }

  for (const [key, expected] of Object.entries(ruleQuery)) {
    const actual = requestQuery[key];
    if (actual === undefined) {
      return false;
    }

    const actualValues = Array.isArray(actual) ? actual.map(String) : [String(actual)];
    if (expected === '*') {
      continue;
    }

    if (!actualValues.some((candidate) => matchPattern(expected, candidate))) {
      return false;
    }
  }

  return true;
}

function headerMatches(ruleHeaders: Record<string, string> | undefined, requestHeaders: Record<string, string | string[]>): boolean {
  if (!ruleHeaders) {
    return true;
  }

  const normalizedRequestHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    normalizedRequestHeaders[key.toLowerCase()] = value;
  }

  for (const [name, pattern] of Object.entries(ruleHeaders)) {
    const actual = normalizedRequestHeaders[name.toLowerCase()];
    if (actual === undefined) {
      return false;
    }

    const values = Array.isArray(actual) ? actual.map(String) : [String(actual)];
    if (!values.some((candidate) => matchPattern(pattern, candidate))) {
      return false;
    }
  }

  return true;
}

export function matchRule(request: {
  method: string;
  hostname: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[]>;
  body?: string | undefined;
}, rule: CacheRule): boolean {
  const match = rule.match;

  if (match.method && !match.method.includes(request.method)) {
    return false;
  }

  if (!listMatches(match.domains, request.hostname)) {
    return false;
  }

  if (!listMatches(match.paths, request.path)) {
    return false;
  }

  if (!queryMatches(match.query, request.query)) {
    return false;
  }

  if (!headerMatches(match.headers, request.headers)) {
    return false;
  }

  // If rule specifies a body pattern, match it against the request body
  if ((match as any).body) {
    const bodyPattern = String((match as any).body);
    const reqBody = request.body ?? '';
    if (bodyPattern !== '*') {
      if (!matchPattern(bodyPattern, reqBody)) {
        return false;
      }
    }
  }

  return true;
}

export function shouldCache(request: {
  method: string;
  hostname: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[]>;
}, rules: CacheRule[]): boolean {
  for (const rule of rules) {
    if (matchRule(request, rule)) {
      return rule.cache;
    }
  }
  return false;
}
