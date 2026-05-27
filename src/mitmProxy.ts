import Proxy = require('http-mitm-proxy');
import path from 'path';
import { CacheStore } from './cacheStore';
import { AppConfig, CONFIG_DIR } from './config';
import { Logger } from './logger';
import { shouldCache } from './rulesEngine';
import { URL } from 'url';
import { normalizeHeaders as normalize } from './proxyUtils';
import { IncomingMessage } from 'http';
import { MitmInstaller } from './mitmInstaller';

export function startMitmProxy(config: AppConfig, cacheStore: CacheStore, logger: Logger, mitmInstaller: MitmInstaller) {
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

  if (method === 'GET' || method === 'HEAD') {
    const requestHeaders = normalize(clientReq.headers as any);
    const cacheKey = JSON.stringify({ method, url: targetUrl, headers: requestHeaders, body: '' });

    cacheStore.get(cacheKey).then((cached) => {
      if (cached) {
        const responseBody = cached.response.body
          ? cached.response.bodyEncoding === 'base64'
            ? Buffer.from(cached.response.body, 'base64')
            : Buffer.from(cached.response.body, 'utf8')
          : undefined;

        ctx.proxyToClientResponse.writeHead(cached.response.status, cached.response.headers);
        ctx.proxyToClientResponse.end(responseBody);
        logger.info('MITM cache hit', { url: targetUrl });
        // NIE wołamy callback() – odpowiedź już wysłana
        return;
      }

      callback(); // cache miss – przepuść do serwera
    }).catch((error) => {
      logger.error('MITM cache lookup error', { error: String(error) });
      callback();
    });
    return; // ← kluczowe: wyjdź, NIE wołaj callback() poniżej
  }

  // POST/PUT/DELETE/etc. – rejestrujemy handlery i wołamy callback()
  // żeby proxy zaczęło przekazywać dane do serwera
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

      const requestContext = { method, hostname: urlObj.hostname, path: urlObj.pathname, query, headers: requestHeaders };
      const cacheAllowed = shouldCache(requestContext, config.rules);

      if (cacheAllowed) {
        const key = JSON.stringify({ method, url: targetUrl, headers: requestHeaders, body: requestBodyStr || '' });
        const cached = await cacheStore.get(key);

        if (cached) {
          const responseBody = cached.response.body
            ? cached.response.bodyEncoding === 'base64'
              ? Buffer.from(cached.response.body, 'base64')
              : Buffer.from(cached.response.body, 'utf8')
            : undefined;

          ctx.proxyToClientResponse.writeHead(cached.response.status, cached.response.headers);
          ctx.proxyToClientResponse.end(responseBody);
          logger.info('MITM cache hit', { url: targetUrl });

          if (ctx.proxyToServerRequest) {
            ctx.proxyToServerRequest.on('error', () => undefined);
            ctx.proxyToServerRequest.destroy();
          }

          cb(null);
          return;
        }
      }
    } catch (error) {
      logger.error('MITM cache lookup error', { error: String(error) });
    }

    cb(null);
  });

  ctx.onResponseEnd((ctx2: any, cb: Function) => {
    cb(); // wywołaj CB od razu, zapis do cache rób asynchronicznie

    (async () => {
      try {
        const requestBody = Buffer.concat(reqChunks);
        const responseBody = Buffer.concat(resChunks);
        const reqContentType = String(clientReq.headers['content-type'] || '');
        const resContentType = String(ctx.serverToProxyResponse?.headers['content-type'] || '');
        const requestBodyStr = isTextMime(reqContentType) ? requestBody.toString('utf8') : requestBody.toString('base64');
        const responseBodyStr = isTextMime(resContentType) ? responseBody.toString('utf8') : responseBody.toString('base64');
        const requestHeaders = normalize(clientReq.headers as any);
        const responseHeaders = normalize(ctx.serverToProxyResponse?.headers || {});

        const urlObj = new URL(targetUrl);
        const query: Record<string, string | string[]> = {};
        for (const [key, value] of urlObj.searchParams.entries()) {
          if (query[key] === undefined) query[key] = value;
          else if (Array.isArray(query[key])) (query[key] as string[]).push(value);
          else query[key] = [query[key] as string, value];
        }

        const requestContext = { method, hostname: urlObj.hostname, path: urlObj.pathname, query, headers: requestHeaders };
        const cacheAllowed = shouldCache(requestContext, config.rules);

        if (cacheAllowed) {
          const key = JSON.stringify({ method, url: targetUrl, headers: requestHeaders, body: requestBodyStr || '' });
          const entry = {
            id: '',
            request: {
              method, url: targetUrl, headers: requestHeaders,
              body: requestBodyStr || undefined,
              bodyEncoding: isTextMime(reqContentType) ? 'utf8' : 'base64',
            },
            response: {
              status: ctx.serverToProxyResponse?.statusCode || 0,
              headers: responseHeaders,
              body: responseBodyStr || undefined,
              bodyEncoding: isTextMime(resContentType) ? 'utf8' : 'base64',
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

  callback(); // tylko dla non-GET/HEAD, po zarejestrowaniu handlerów
});

  proxy.listen({ port: config.proxy.port, sslCaDir: proxyCaDir, forceSNI: true }, async () => {
    logger.info(`MITM proxy listening on port ${config.proxy.port}`);

    await new Promise(r => setTimeout(r, 500));

    await mitmInstaller.initialize();

    if (process.platform === 'win32') {
      try {
        await mitmInstaller.ensureCAInstalled();
      } catch (error) {
        logger.warn('Automatic Windows MITM CA installation was not completed.', { error: String(error) });
        mitmInstaller.logFirstRunInstructions();
      }
    } else {
      mitmInstaller.logFirstRunInstructions();
    }
  });
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
