import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { AppConfig, CacheRule, saveConfig, validateCacheRule, CONFIG_DIR } from './config';
import { CacheStore } from './cacheStore';
import { Logger } from './logger';

function findRuleIndex(rules: CacheRule[], name: string): number {
  return rules.findIndex((rule) => rule.name === name);
}

export function registerAdminRoutes(app: any, config: AppConfig, cacheStore: CacheStore, logger: Logger) {
  app.use(express.static(path.resolve(process.cwd(), 'public', 'admin')));

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.resolve(process.cwd(), 'public', 'admin', 'index.html'));
  });

  app.get('/config', (_req: Request, res: Response) => {
    res.json({ proxy: config.proxy, rules: config.rules });
  });

  app.get('/rules', (_req: Request, res: Response) => {
    res.json(config.rules);
  });

  app.get('/rules/:name', (req: Request, res: Response) => {
    const rule = config.rules.find((item) => item.name === req.params.name);
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.json(rule);
  });

  app.post('/rules', (req: Request, res: Response) => {
    try {
      const rule = validateCacheRule(req.body);
      if (findRuleIndex(config.rules, rule.name) !== -1) {
        res.status(409).json({ error: 'Rule already exists' });
        return;
      }

      config.rules.push(rule);
      saveConfig(config);
      res.status(201).json(rule);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  app.put('/rules/:name', (req: Request, res: Response) => {
    try {
      const rule = validateCacheRule(req.body);
      const index = findRuleIndex(config.rules, req.params.name);
      if (index === -1) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }

      config.rules[index] = rule;
      saveConfig(config);
      res.json(rule);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  app.delete('/rules/:name', (req: Request, res: Response) => {
    const index = findRuleIndex(config.rules, req.params.name);
    if (index === -1) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const [deleted] = config.rules.splice(index, 1);
    saveConfig(config);
    res.json(deleted);
  });

  app.get('/cache', async (_req: Request, res: Response) => {
    const keys = await cacheStore.listKeys();
    const items = await Promise.all(
      keys.map(async (key) => ({
        key,
        item: await cacheStore.getManifestItem(key),
      }))
    );

    res.json(items.filter((entry) => entry.item !== null));
  });

  app.get('/cache/:key', async (req: Request, res: Response) => {
    const key = req.params.key;
    const entry = await cacheStore.peek(key);
    if (!entry) {
      res.status(404).json({ error: 'Cache entry not found' });
      return;
    }

    res.json(entry);
  });

  app.delete('/cache/:key', async (req: Request, res: Response) => {
    try {
      const key = req.params.key;
      const success = await cacheStore.delete(key);
      if (!success) {
        res.status(404).json({ error: 'Cache entry not found' });
        return;
      }
      res.json({ success: true, message: 'Cache entry deleted successfully' });
    } catch (error) {
      logger.error('Delete cache entry error', { error: String(error) });
      res.status(500).json({ error: 'Delete cache entry failed', details: String(error) });
    }
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/status', async (_req: Request, res: Response) => {
    try {
      const stats = await cacheStore.getStats();
      const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: process.uptime(),
        proxyPort: config.proxy.port,
        adminPort: config.proxy.adminPort,
        adminEnabled: config.proxy.adminEnabled,
        mitmEnabled: config.proxy.mitmEnabled,
        encryptionEnabled: config.proxy.encryption.enabled,
        rulesCount: config.rules.length,
        cacheStats: stats,
        process: {
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
        },
      };

      res.json(status);
    } catch (error) {
      logger.error('Admin status error', error);
      res.status(500).json({ error: 'Unable to compute status', details: String(error) });
    }
  });

  app.get('/mitm-ca', async (_req: Request, res: Response) => {
    if (!config.proxy.mitmEnabled) {
      res.status(400).json({ error: 'MITM proxy not enabled' });
      return;
    }

    try {
      const caCertPath = path.join(CONFIG_DIR, 'mitm', 'proxy-ca', 'certs', 'ca.pem');
      const cert = await fs.readFile(caCertPath, 'utf-8');
      res.set('Content-Type', 'application/x-pem-file');
      res.set('Content-Disposition', 'attachment; filename="mitm-ca.pem"');
      res.send(cert);
    } catch (error) {
      logger.error('MITM CA download error', { error: String(error) });
      res.status(500).json({ error: 'Unable to download MITM CA certificate', details: String(error) });
    }
  });


}


