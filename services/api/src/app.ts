import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import Router from '@koa/router';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUiDist from 'swagger-ui-dist';
import { config } from './config.js';
import { database, redis } from './db/pool.js';
import { authRouter } from './routes/auth.js';
import { resourceRouter } from './routes/resources.js';
import { shopRouter, publicShopRouter } from './routes/shops.js';
import { meRouter } from './routes/me.js';

export function createApp() {
  const app = new Koa();
  app.proxy = config.isProduction;

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const databaseCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      const status =
        databaseCode === '23505'
          ? 409
          : typeof error === 'object' && error !== null && 'status' in error
            ? Number((error as { status: unknown }).status)
            : 500;
      ctx.status = status;
      ctx.body = {
        error:
          status >= 500
            ? 'Внутренняя ошибка сервера'
            : databaseCode === '23505'
              ? 'Запись с такими данными уже существует'
              : (error as Error).message,
      };
      if (status >= 500) ctx.app.emit('error', error, ctx);
    }
  });

  app.use(
    cors({
      credentials: true,
      origin: (ctx) => {
        const origin = ctx.get('origin');
        const allowed = [config.ADMIN_ORIGIN, config.STOREFRONT_ORIGIN];
        return allowed.includes(origin) ? origin : '';
      },
    }),
  );
  app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '2mb' }));

  const health = new Router();
  health.get('/health', async (ctx) => {
    await Promise.all([database.query('SELECT 1'), redis.ping()]);
    ctx.body = { status: 'ok' };
  });
  const api = new Router({ prefix: '/api/v1' });
  api.use(authRouter.routes(), authRouter.allowedMethods());
  api.use(shopRouter.routes(), shopRouter.allowedMethods());
  api.use(publicShopRouter.routes(), publicShopRouter.allowedMethods());
  api.use(meRouter.routes(), meRouter.allowedMethods());
  api.use(resourceRouter.routes(), resourceRouter.allowedMethods());

  const documentation = new Router();
  const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
  documentation.get('/api/openapi.json', async (ctx) => {
    ctx.type = 'application/json';
    ctx.body = await readFile(path.resolve(serviceDirectory, '../openapi.json'), 'utf8');
  });
  documentation.get('/api/docs', (ctx) => {
    ctx.type = 'text/html';
    ctx.body = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>API — Мастерская</title><link rel="stylesheet" href="/api/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger-ui'})</script></body></html>`;
  });
  const swaggerDirectory = swaggerUiDist.getAbsoluteFSPath();
  documentation.get('/api/docs/:asset', async (ctx) => {
    const allowedAssets = new Set([
      'swagger-ui.css',
      'swagger-ui-bundle.js',
      'swagger-ui-standalone-preset.js',
      'favicon-32x32.png',
      'favicon-16x16.png',
    ]);
    const asset = ctx.params.asset ?? '';
    if (!allowedAssets.has(asset)) ctx.throw(404, 'Файл не найден');
    const assetPath = path.join(swaggerDirectory, asset);
    ctx.type = path.extname(assetPath);
    ctx.body = createReadStream(assetPath);
  });

  app.use(health.routes());
  app.use(api.routes());
  app.use(api.allowedMethods());
  app.use(documentation.routes());
  app.use(documentation.allowedMethods());
  app.on('error', (error) => console.error('Ошибка API', error));
  return app;
}
