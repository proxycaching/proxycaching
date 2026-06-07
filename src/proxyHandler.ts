import { Request, Response, RequestHandler } from 'express';
import { AppConfig } from './config';
import { CacheStore, CacheEntry } from './cacheStore';
import { shouldCache, getMatchedRule } from './rulesEngine';
import { Logger } from './logger';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { buildCacheKey } from './proxyUtils';

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  const keys = Object.keys(headers).sort();

  for (const key of keys) {
    const value = headers[key];
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item)).sort();
    } else {
      normalized[key] = String(value);
    }
  }

  return normalized;
}

function isTextMime(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }

  const type = contentType.toLowerCase();
  return (
    type.includes('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('html') ||
    type.includes('css') ||
    type.includes('csv') ||
    type.includes('yaml') ||
    type.includes('form-urlencoded')
  );
}

function getRequestBodyBuffer(req: Request): Buffer | undefined {
  const body = req.body;

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }

  if (typeof body === 'object' && body !== null) {
    return Buffer.from(JSON.stringify(body), 'utf8');
  }

  return undefined;
}

function getBodyString(buffer: Buffer | undefined, contentType?: string): { body: string | undefined; bodyEncoding?: 'utf8' | 'base64' } {
  if (!buffer) {
    return { body: undefined };
  }

  if (isTextMime(contentType)) {
    return { body: buffer.toString('utf8'), bodyEncoding: 'utf8' };
  }

  return { body: buffer.toString('base64'), bodyEncoding: 'base64' };
}

export function resolveProxyTargetUrl(rawUrl: string | undefined, hostHeader: string | undefined): string {
  const urlString = (rawUrl || '').trim();
  if (!urlString) {
    throw new Error('Missing target URL.');
  }

  const absoluteProtocols = ['http://', 'https://', 'ws://', 'wss://'];
  if (absoluteProtocols.some((prefix) => urlString.toLowerCase().startsWith(prefix))) {
    return new URL(urlString).toString();
  }

  if (!hostHeader) {
    throw new Error('Missing Host header.');
  }

  const normalizedHost = hostHeader.trim();
  const isTlsHost = normalizedHost.endsWith(':443');
  const protocol = isTlsHost ? 'https:' : 'http:';
  const path = urlString.startsWith('/') ? urlString : `/${urlString}`;
  return new URL(`${protocol}//${normalizedHost}${path}`).toString();
}

function buildTargetUrl(req: Request): string {
  return resolveProxyTargetUrl(req.originalUrl || req.url, req.headers.host);
}

// cache key creation uses a hashed canonical identity
// moved to `proxyUtils.buildCacheKey`

function buildRequestContext(req: Request, targetUrl: string) {
  const url = new URL(targetUrl);
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      (query[key] as string[]).push(value);
    } else {
      query[key] = [query[key] as string, value];
    }
  }

  return {
    method: req.method,
    hostname: url.hostname,
    path: url.pathname,
    query,
    headers: normalizeHeaders(req.headers),
  };
}

function removeHopByHopHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]> {
  const excluded = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ]);
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!excluded.has(key.toLowerCase()) && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function hasContentEncoding(headers: Record<string, string | string[]>) {
  const encoding = headers['content-encoding'];
  return Array.isArray(encoding) ? encoding.length > 0 : typeof encoding === 'string' && encoding.trim().length > 0;
}

function sendCachedResponse(res: Response, entry: CacheEntry) {
  const isStaleCompressedEntry = hasContentEncoding(entry.response.headers) && entry.response.bodyEncoding !== 'base64';
  if (isStaleCompressedEntry) {
    throw new Error('Stale compressed cache entry detected');
  }

  const responseBodyEncoding = entry.response.bodyEncoding === 'base64' || hasContentEncoding(entry.response.headers)
    ? 'base64'
    : 'utf8';
  const headers = removeHopByHopHeaders(entry.response.headers);
  delete headers['content-length'];
  if (responseBodyEncoding !== 'base64') {
    delete headers['content-encoding'];
  }

  res.status(entry.response.status);
  res.set(headers as Record<string, string | string[]>);

  if (!entry.response.body) {
    res.end();
    return;
  }

  if (responseBodyEncoding === 'base64') {
    res.send(Buffer.from(entry.response.body, 'base64'));
  } else {
    res.send(entry.response.body);
  }
}

async function forwardRequest(targetUrl: string, req: Request): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer }> {
  const url = new URL(targetUrl);
  const transport = url.protocol === 'https:' ? https : http;
  const headers = { ...req.headers } as Record<string, string | string[]>;
  delete headers.host;
  delete headers['content-length'];

  const options: http.RequestOptions = {
    method: req.method,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    path: `${url.pathname}${url.search}`,
    headers,
  };

  const bodyBuffer = getRequestBodyBuffer(req);

  return new Promise((resolve, reject) => {
    const proxyReq = transport.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];

      proxyRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      proxyRes.on('end', () => {
        resolve({
          status: proxyRes.statusCode || 500,
          headers: normalizeHeaders(proxyRes.headers),
          body: Buffer.concat(chunks),
        });
      });
    });

    proxyReq.on('error', reject);

    if (bodyBuffer && bodyBuffer.length > 0) {
      proxyReq.write(bodyBuffer);
    }

    proxyReq.end();
  });
}

function buildCacheEntry(req: Request, targetUrl: string, upstream: { status: number; headers: Record<string, string | string[]>; body: Buffer }): CacheEntry {
  const requestBody = getRequestBodyBuffer(req);
  const contentType = String(req.headers['content-type'] || '');
  const requestBodyData = getBodyString(requestBody, contentType);
  const responseBodyData = getBodyString(upstream.body, String(upstream.headers['content-type'] || ''));

  return {
    id: '',
    request: {
      method: req.method,
      url: targetUrl,
      headers: normalizeHeaders(req.headers),
      body: requestBodyData.body,
      bodyEncoding: requestBodyData.bodyEncoding,
    },
    response: {
      status: upstream.status,
      headers: upstream.headers,
      body: responseBodyData.body,
      bodyEncoding: responseBodyData.bodyEncoding,
    },
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    hitCount: 1,
    metadata: {},
  };
}

export function createProxyHandler(config: AppConfig, cacheStore: CacheStore, logger: Logger): RequestHandler {
  return async (req: Request, res: Response) => {
    if (req.method === 'CONNECT') {
      res.status(405).send({ error: 'CONNECT is handled by the raw proxy server.' });
      return;
    }

    if (req.headers.upgrade) {
      res.status(400).send({ error: 'Upgrade requests are handled by the raw proxy server.' });
      return;
    }

    try {
      const targetUrl = buildTargetUrl(req);
      const requestContext = buildRequestContext(req, targetUrl);
          // include body in requestContext for rule matching
          const bodyBuf = getRequestBodyBuffer(req);
          const bodyStr = bodyBuf ? bodyBuf.toString('base64') : undefined;
          (requestContext as any).body = bodyStr ? bodyStr : undefined;
      const cacheAllowed = shouldCache(requestContext, config.rules);
      const matchedRule = getMatchedRule(requestContext, config.rules);
          const bodyBuffer = getRequestBodyBuffer(req);
          const bodyString = bodyBuffer ? bodyBuffer.toString('base64') : undefined;
          const cacheKey = buildCacheKey(req.method, targetUrl, normalizeHeaders(req.headers), bodyString, matchedRule?.groupBy);

      logger.debug('Incoming request', {
        method: req.method,
        url: targetUrl,
        cacheAllowed,
      });

      if (cacheAllowed) {
        const cached = await cacheStore.get(cacheKey);
        if (cached) {
          const isStaleCompressedEntry = hasContentEncoding(cached.response.headers) && cached.response.bodyEncoding !== 'base64';
          if (isStaleCompressedEntry) {
            logger.warn('Skipping stale compressed cache entry', { method: req.method, url: targetUrl, key: cacheKey });
          } else {
            logger.info('Cache hit', { method: req.method, url: targetUrl, key: cacheKey });
            sendCachedResponse(res, cached);
            return;
          }
        }

        logger.info('Cache miss', { method: req.method, url: targetUrl, key: cacheKey });
      } else {
        logger.debug('Request skipped from caching by rule', { method: req.method, url: targetUrl });
      }

      const upstream = await forwardRequest(targetUrl, req);

      if (cacheAllowed) {
        const entry = buildCacheEntry(req, targetUrl, upstream);
        await cacheStore.set(cacheKey, entry);
        logger.info('Cached response', { method: req.method, url: targetUrl, status: upstream.status, key: cacheKey });
      }

      const headers = removeHopByHopHeaders(upstream.headers);
      res.status(upstream.status);
      res.set(headers as Record<string, string | string[]>);
      res.send(upstream.body);
    } catch (error) {
      logger.error('Proxy error', { message: String(error), stack: (error as Error).stack });
      res.status(502).send({ error: 'Proxy request failed', details: String(error) });
    }
  };
}
