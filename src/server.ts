import express from 'express';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import { loadConfig, CONFIG_DIR } from './config';
import { registerAdminRoutes } from './adminApi';
import { createProxyHandler, resolveProxyTargetUrl } from './proxyHandler';
import { startMitmProxy } from './mitmProxy';
import { CacheStore } from './cacheStore';
import { createLogger } from './logger';

function handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
  const target = req.url || '';
  let host: string;
  let port = 443;

  try {
    const parsed = new URL(`https://${target}`);
    host = parsed.hostname;
    port = Number(parsed.port) || 443;
  } catch {
    clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    clientSocket.end();
    return;
  }

  const serverSocket = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) {
      serverSocket.write(head);
    }
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });

  const closeSockets = () => {
    if (!clientSocket.destroyed) {
      clientSocket.destroy();
    }
    if (!serverSocket.destroyed) {
      serverSocket.destroy();
    }
  };

  serverSocket.on('error', () => {
    if (!clientSocket.destroyed) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
    closeSockets();
  });

  clientSocket.on('error', closeSockets);
  serverSocket.on('close', closeSockets);
}

function handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
  let targetUrl: string;

  try {
    targetUrl = resolveProxyTargetUrl(req.url, req.headers.host as string | undefined);
  } catch (error) {
    socket.end();
    return;
  }

  const url = new URL(targetUrl);
  const isSecure = url.protocol === 'https:' || url.protocol === 'wss:';
  const transport = isSecure ? https : http;
  const requestProtocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
  const options: http.RequestOptions = {
    protocol: requestProtocol,
    hostname: url.hostname,
    port: url.port || (isSecure ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: req.method,
    headers: req.headers,
    agent: false,
  };

  const proxyReq = transport.request(options);

  const cleanup = () => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  };

  proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
    const statusLine = `HTTP/${_proxyRes.httpVersion || '1.1'} ${_proxyRes.statusCode} ${_proxyRes.statusMessage || 'Switching Protocols'}\r\n`;
    socket.write(statusLine);

    for (const [headerName, headerValue] of Object.entries(_proxyRes.headers)) {
      if (headerValue) {
        if (Array.isArray(headerValue)) {
          socket.write(`${headerName}: ${headerValue.join(', ')}\r\n`);
        } else {
          socket.write(`${headerName}: ${headerValue}\r\n`);
        }
      }
    }
    socket.write('\r\n');

    if (proxyHead && proxyHead.length) {
      proxySocket.write(proxyHead);
    }
    if (head && head.length) {
      proxySocket.write(head);
    }

    socket.pipe(proxySocket);
    proxySocket.pipe(socket);

    socket.on('error', () => proxySocket.destroy());
    proxySocket.on('error', () => socket.destroy());
  });

  proxyReq.on('response', (proxyRes) => {
    // If the upstream server does not switch protocols, send the response back to the client socket.
    const statusLine = `HTTP/${proxyRes.httpVersion || '1.1'} ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}\r\n`;
    socket.write(statusLine);
    for (const [headerName, headerValue] of Object.entries(proxyRes.headers)) {
      if (headerValue) {
        if (Array.isArray(headerValue)) {
          socket.write(`${headerName}: ${headerValue.join(', ')}\r\n`);
        } else {
          socket.write(`${headerName}: ${headerValue}\r\n`);
        }
      }
    }
    socket.write('\r\n');
    proxyRes.pipe(socket);
  });

  proxyReq.on('error', cleanup);
  socket.on('error', cleanup);
  proxyReq.end();
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.proxy.logging.level);
  const proxyApp = express();

  proxyApp.use(express.raw({ type: '*/*', limit: '10mb' }));

  const cacheStore = new CacheStore(config.proxy.podcachePath, config.proxy.encryption, logger);
  await cacheStore.initialize();

  if (config.proxy.adminEnabled) {
    const adminApp = express();
    adminApp.use(express.json({ limit: '2mb' }));
    registerAdminRoutes(adminApp, config, cacheStore, logger);
    adminApp.listen(config.proxy.adminPort, () => {
      logger.info(`Admin server listening on http://localhost:${config.proxy.adminPort}`);
    });
  }

  proxyApp.all('*', createProxyHandler(config, cacheStore, logger));

  if (config.proxy.mitmEnabled) {
    // Start MITM proxy which will handle CONNECT and intercept TLS to allow caching of HTTPS
    startMitmProxy(config, cacheStore, logger);
  } else {
    const proxyServer = http.createServer(proxyApp);
    proxyServer.on('connect', handleConnect);
    proxyServer.on('upgrade', handleUpgrade);
    proxyServer.listen(config.proxy.port, () => {
      logger.info(`Proxy server listening on http://localhost:${config.proxy.port}`);
    });
  }
}

main().catch((error) => {
  console.error('Failed to start proxy server:', error);
  process.exit(1);
});
