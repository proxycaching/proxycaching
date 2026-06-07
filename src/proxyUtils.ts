import http from 'http';
import crypto from 'crypto';

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

function removeHopByHop(headers: Record<string, string | string[]>): Record<string, string | string[]> {
  const excluded = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'date'
  ]);

  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!excluded.has(k.toLowerCase()) && v !== undefined) out[k] = v;
  }
  return out;
}

function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // normalize hostname, pathname, and sorted query params
    const params: string[] = [];
    const entries: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) entries.push([k, v]);
    entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    for (const [k, v] of entries) params.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return `${u.protocol}//${u.hostname}${u.pathname}${query}`;
  } catch {
    return raw;
  }
}

export function buildCacheKey(method: string, url: string, headers: Record<string, string | string[]>, bodyString?: string, groupBy?: 'full' | 'url-only'): string {
  const canonicalUrl = canonicalizeUrl(url);
  const filteredHeaders = removeHopByHop(headers);
  const canonicalHeaders = normalizeHeaders(filteredHeaders as any);
  
  // Use groupBy strategy if specified, otherwise default to 'full'
  const strategy = groupBy || 'full';
  
  let payload: string;
  if (strategy === 'url-only') {
    // Group by URL only, ignoring body and headers
    payload = JSON.stringify({ url: canonicalUrl });
  } else {
    // Default: include method, url, headers, and body
    payload = JSON.stringify({ method: method.toUpperCase(), url: canonicalUrl, headers: canonicalHeaders, body: bodyString || '' });
  }
  
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `v2:${hash}`;
}
