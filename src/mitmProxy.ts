import Proxy from 'http-mitm-proxy';
import path from 'path';
import { CacheStore } from './cacheStore';
import { AppConfig, CONFIG_DIR } from './config';
import { Logger } from './logger';
import { shouldCache, getMatchedRule } from './rulesEngine';
import { URL } from 'url';
import { normalizeHeaders as normalize } from './proxyUtils';
import { IncomingMessage } from 'http';
import { buildCacheKey } from './proxyUtils';

export function startMitmProxy(config: AppConfig, cacheStore: CacheStore, logger: Logger) {
  const proxyCaDir = path.join(CONFIG_DIR, 'mitm', 'proxy-ca');
  
  const proxy = Proxy();

  logger.info('Starting MITM proxy', { proxyCaDir });
  

  proxy.onError((ctx: any, err?: Error) => {
    logger.error('MITM proxy error', { error: String(err) });
  });

  proxy.onRequest((ctx: any, callback: Function) => {
  const clientReq = ctx.clientToProxyRequest as IncomingMessage;
  const host = clientReq.headers.host || '';
  const method = clientReq.method || 'GET';
  const requestPath = clientReq.url || '/';
  const isSsl = !!ctx.isSSL;
  const protocol = isSsl ? 'https:' : 'http:';
  const targetUrl = new URL(`${protocol}//${host}${requestPath}`).toString();

  const reqChunks: Buffer[] = [];
  ctx.onRequestData((ctx2: any, chunk: Buffer, cb: Function) => {
    reqChunks.push(chunk);
    cb(null, chunk);
  });

  const resChunks: Buffer[] = [];
  ctx.onResponseData((ctx2: any, chunk: Buffer, cb: Function) => {
    resChunks.push(chunk);
    cb(null, chunk);
  });

  ctx.onRequestEnd(async (ctx2: any, cb: Function) => {
    try {
      const requestBody = Buffer.concat(reqChunks);
      const reqContentType = String(clientReq.headers['content-type'] || '');
      const requestBodyStr = isTextMime(reqContentType)
        ? requestBody.toString('utf8')
        : requestBody.toString('base64');
      const requestHeaders = normalize(clientReq.headers as any);

      const urlObj = new URL(targetUrl);
      const query: Record<string, string | string[]> = {};
      for (const [key, value] of urlObj.searchParams.entries()) {
        if (query[key] === undefined) query[key] = value;
        else if (Array.isArray(query[key])) (query[key] as string[]).push(value);
        else query[key] = [query[key] as string, value];
      }

      const requestContext = { method, hostname: urlObj.hostname, path: urlObj.pathname, query, headers: requestHeaders, body: requestBodyStr || undefined };
      const cacheAllowed = shouldCache(requestContext, config.rules);
      const matchedRule = getMatchedRule(requestContext, config.rules);

      if (cacheAllowed) {
        const key = buildCacheKey(method, targetUrl, requestHeaders, requestBodyStr || undefined, matchedRule?.groupBy);
        const cached = await cacheStore.get(key);

        if (cached) {
          const isStaleCompressedEntry = hasContentEncoding(cached.response.headers) && cached.response.bodyEncoding !== 'base64';
          if (isStaleCompressedEntry) {
            logger.warn('Skipping stale compressed cache entry', { url: targetUrl, key });
          } else {
            const responseBodyEncoding = cached.response.bodyEncoding === 'base64' || hasContentEncoding(cached.response.headers)
              ? 'base64'
              : 'utf8';
            const responseBody = cached.response.body
              ? responseBodyEncoding === 'base64'
                ? Buffer.from(cached.response.body, 'base64')
                : Buffer.from(cached.response.body, 'utf8')
              : undefined;

            const hitHeaders = removeHopByHopHeaders(cached.response.headers);
            delete hitHeaders['content-length'];
            if (responseBodyEncoding !== 'base64') {
              delete hitHeaders['content-encoding'];
            }

            ctx.proxyToClientResponse.writeHead(cached.response.status, hitHeaders);
            ctx.proxyToClientResponse.end(responseBody);
            logger.info('MITM cache hit', { url: targetUrl });

            if (ctx.proxyToServerRequest) {
              ctx.proxyToServerRequest.on('error', () => undefined);
              ctx.proxyToServerRequest.destroy();
            }
            if (ctx.serverToProxyResponse) {
              ctx.serverToProxyResponse.on('error', () => undefined);
              ctx.serverToProxyResponse.destroy();
            }

            cb(null);
            return;
          }
        }
      }
    } catch (error) {
      logger.error('MITM cache lookup error', { error: String(error) });
    }

    cb(null);
  });

  ctx.onResponseEnd((ctx2: any, cb: Function) => {
    cb();

    (async () => {
      try {
        const requestBody = Buffer.concat(reqChunks);
        const responseBody = Buffer.concat(resChunks);
        const reqContentType = String(clientReq.headers['content-type'] || '');
        const reqContentEncoding = String(clientReq.headers['content-encoding'] || '');
        const resContentType = String(ctx.serverToProxyResponse?.headers['content-type'] || '');
        const resContentEncoding = String(ctx.serverToProxyResponse?.headers['content-encoding'] || '');
        const requestBodyData = getBodyString(requestBody, reqContentType, reqContentEncoding);
        const responseBodyData = getBodyString(responseBody, resContentType, resContentEncoding);
        const requestHeaders = normalize(clientReq.headers as any);
        const responseHeaders = normalize(ctx.serverToProxyResponse?.headers || {});

        const urlObj = new URL(targetUrl);
        const query: Record<string, string | string[]> = {};
        for (const [key, value] of urlObj.searchParams.entries()) {
          if (query[key] === undefined) query[key] = value;
          else if (Array.isArray(query[key])) (query[key] as string[]).push(value);
          else query[key] = [query[key] as string, value];
        }

        const requestContext = { method, hostname: urlObj.hostname, path: urlObj.pathname, query, headers: requestHeaders, body: requestBodyData.body || undefined };
        const cacheAllowed = shouldCache(requestContext, config.rules);
        const matchedRule = getMatchedRule(requestContext, config.rules);

        if (cacheAllowed) {
          const key = buildCacheKey(method, targetUrl, requestHeaders, requestBodyData.body || undefined, matchedRule?.groupBy);
          const entry = {
            id: '',
            request: {
              method, url: targetUrl, headers: requestHeaders,
              body: requestBodyData.body || undefined,
              bodyEncoding: requestBodyData.bodyEncoding,
            },
            response: {
              status: ctx.serverToProxyResponse?.statusCode || 0,
              headers: responseHeaders,
              body: responseBodyData.body || undefined,
              bodyEncoding: responseBodyData.bodyEncoding,
            },
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            hitCount: 1,
            metadata: {},
          } as any;

          await cacheStore.set(key, entry);
          logger.info('MITM cached entry', { url: targetUrl });
        }
      } catch (error) {
        logger.error('MITM capture error', { error: String(error) });
      }
    })();
  });

  callback();
});

  proxy.listen({ port: config.proxy.port, sslCaDir: proxyCaDir, forceSNI: true }, async () => {
    logger.info(`MITM proxy listening on port ${config.proxy.port}`);
  });
}

function getBodyString(buffer: Buffer | undefined, contentType?: string, contentEncoding?: string) {
  if (!buffer) {
    return { body: undefined };
  }

  const encoding = contentEncoding?.toLowerCase();
  const isCompressed = encoding && encoding !== 'identity';
  if (isCompressed || !isTextMime(contentType)) {
    return { body: buffer.toString('base64'), bodyEncoding: 'base64' };
  }

  return { body: buffer.toString('utf8'), bodyEncoding: 'utf8' };
}

function removeHopByHopHeaders(headers: Record<string, string | string[]>) {
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

function isTextMime(contentType?: string): boolean {
  if (!contentType) return true;
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
