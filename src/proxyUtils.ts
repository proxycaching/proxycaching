import http from 'http';

export function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  const keys = Object.keys(headers).sort();

  for (const key of keys) {
    const value = (headers as any)[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) normalized[key] = value.map((v) => String(v)).sort();
    else normalized[key] = String(value);
  }

  return normalized;
}
