import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { AuthIdentity } from '../src/security/tokens.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/shop_platform';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-access-token-secret-is-long-enough-123456';
process.env.ADMIN_ORIGIN = 'http://localhost:5173';
process.env.STOREFRONT_ORIGIN = 'http://localhost:3000';
process.env.EMAIL_DEBUG_CODE = 'true';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  const databaseQuery = vi.fn();
  const clientQuery = vi.fn();
  const databaseConnect = vi.fn(async () => ({ query: clientQuery, release: vi.fn() }));
  const redis = {
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const existed = values.has(key);
      values.delete(key);
      return Number(existed);
    }),
    incr: vi.fn(async (key: string) => {
      const value = Number(values.get(key) ?? '0') + 1;
      values.set(key, String(value));
      return value;
    }),
    expire: vi.fn(async () => 1),
    ping: vi.fn(async () => 'PONG'),
    xadd: vi.fn(async () => '1-0'),
    quit: vi.fn(async () => 'OK'),
    values,
  };
  return { databaseQuery, databaseConnect, clientQuery, redis };
});

vi.mock('../src/db/pool.js', () => ({
  database: { query: mocks.databaseQuery, connect: mocks.databaseConnect, end: vi.fn() },
  redis: mocks.redis,
  publishEvent: vi.fn(async () => undefined),
  closeConnections: vi.fn(async () => undefined),
}));

const { createApp } = await import('../src/app.js');
const {
  createAccessToken,
  verifyAccessToken,
  createRefreshSession,
  readRefreshSession,
  revokeRefreshSession,
} = await import('../src/security/tokens.js');
const app = createApp();
const server = app.callback();
const adminUser = {
  id: '07d4d24b-6356-47d4-aa2a-d6e16d8f0611',
  email: 'admin@example.test',
  role: 'platform_admin' as const,
};
const ownerUser = {
  id: '49f2b1a7-4a7f-4f59-85c0-1c2b49009fe2',
  email: 'owner@example.test',
  role: 'shop_owner' as const,
};
const shopId = 'ce1acb74-3e94-44ca-807c-bd064b58c8aa';

function result(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length };
}

async function tokenFor(user: AuthIdentity = adminUser) {
  return createAccessToken(user);
}

function authenticated(token: string) {
  const header = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => header(request(server).get(path)),
    post: (path: string) => header(request(server).post(path)),
    patch: (path: string) => header(request(server).patch(path)),
    delete: (path: string) => header(request(server).delete(path)),
  };
}

beforeEach(() => {
  mocks.redis.values.clear();
  mocks.databaseQuery.mockReset();
  mocks.databaseConnect.mockReset();
  mocks.clientQuery.mockReset();
  mocks.databaseQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT 1')) return result([{ '?column?': 1 }]);
    if (sql.includes('SELECT id FROM users WHERE email')) return result([{ id: adminUser.id }]);
    if (sql.includes('UPDATE users SET email_verified')) return result([adminUser]);
    if (sql.includes('SELECT id, email, role FROM users')) return result([adminUser]);
    if (sql.includes('SELECT COUNT(*)::int AS count')) return result([{ count: 0 }]);
    if (sql.includes('SELECT * FROM shops')) return result([]);
    return result([]);
  });
  mocks.clientQuery.mockImplementation(async () => result([]));
  mocks.databaseConnect.mockImplementation(async () => ({
    query: mocks.clientQuery,
    release: vi.fn(),
  }));
});

describe('API platform', () => {
  it('reports the status of the API, PostgreSQL and Redis', async () => {
    const response = await request(server).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(mocks.redis.ping).toHaveBeenCalledOnce();
  });

  it('serves the OpenAPI file and the local Swagger UI', async () => {
    const document = await request(server).get('/api/openapi.json');
    expect(document.status).toBe(200);
    expect(document.body.openapi).toBe('3.1.0');
    expect((await request(server).get('/api/docs')).text).toContain('swagger-ui-bundle.js');
    expect((await request(server).get('/api/docs/swagger-ui.css')).status).toBe(200);
    expect((await request(server).get('/api/docs/unknown.js')).status).toBe(404);
  });

  it('rejects invalid email addresses before accessing the database', async () => {
    const response = await request(server).post('/api/v1/auth/login').send({ email: 'почта' });
    expect(response.status).toBe(400);
    expect(mocks.databaseQuery).not.toHaveBeenCalled();
  });

  it('sends a one-time code and confirms it with a short access token and HttpOnly refresh cookie', async () => {
    const sent = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@example.test' });
    expect(sent.status).toBe(202);
    expect(sent.body.debugCode).toMatch(/^\d{6}$/);

    const invalid = await request(server)
      .post('/api/v1/auth/confirm')
      .send({ email: adminUser.email, otp: '000000' });
    expect(invalid.status).toBe(400);

    const confirmed = await request(server)
      .post('/api/v1/auth/confirm')
      .send({ email: adminUser.email, otp: sent.body.debugCode });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.user.id).toBe(adminUser.id);
    const cookieHeader = confirmed.headers['set-cookie']?.[0] ?? '';
    expect(cookieHeader.toLowerCase()).toContain('httponly');
    expect(await verifyAccessToken(confirmed.body.accessToken)).toMatchObject(adminUser);
    const cookie = cookieHeader.split(';')[0] ?? '';
    const refreshed = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    const loggedOut = await request(server).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(loggedOut.status).toBe(204);
    expect(
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .then((response) => response.status),
    ).toBe(401);
  });

  it('creates a new owner account and rate limits code requests', async () => {
    let userExists = false;
    mocks.databaseQuery.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM users WHERE email'))
        return result(
          userExists && parameters[0] === ownerUser.email ? [{ id: ownerUser.id }] : [],
        );
      if (sql.startsWith('INSERT INTO users')) {
        userExists = true;
        return result([]);
      }
      return result([]);
    });
    const registered = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: ownerUser.email, firstName: 'Александр', lastName: 'Алфеев' });
    expect(registered.status).toBe(202);
    expect(registered.body.debugCode).toMatch(/^\d{6}$/);
    const duplicate = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: ownerUser.email, firstName: 'Александр', lastName: 'Алфеев' });
    expect(duplicate.status).toBe(409);

    const email = 'rate@example.test';
    await mocks.redis.incr(`otp-limit:127.0.0.1:${email}`);
    mocks.redis.values.set(`otp-limit:127.0.0.1:${email}`, '5');
    const limited = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, firstName: 'Иван', lastName: 'Иванов' });
    expect(limited.status).toBe(429);
  });

  it('rejects invalid access tokens and keeps refresh tokens out of Redis keys', async () => {
    const refresh = await createRefreshSession(ownerUser.id);
    expect(await readRefreshSession(refresh)).toBe(ownerUser.id);
    await revokeRefreshSession(refresh);
    expect(await readRefreshSession(refresh)).toBeNull();
    await expect(verifyAccessToken('invalid.token.value')).rejects.toThrow();
    expect([...mocks.redis.values.keys()].every((key) => key.startsWith('session:'))).toBe(true);
  });

  it('requires authentication and applies role restrictions to platform resources', async () => {
    expect((await request(server).get('/api/v1/news')).status).toBe(401);
    const owner = await tokenFor(ownerUser);
    expect((await authenticated(owner).get('/api/v1/news')).status).toBe(403);
    expect((await authenticated(owner).get('/api/v1/goods?shopId=not-a-uuid')).status).toBe(400);
  });

  it('lists, creates, reads, updates and deletes platform resources with pagination', async () => {
    const token = await tokenFor();
    mocks.databaseQuery.mockImplementation(async (sql: string, _parameters: unknown[] = []) => {
      if (sql.includes('COUNT(*)')) return result([{ count: 2 }]);
      if (sql.startsWith('SELECT * FROM brands ORDER'))
        return result([
          {
            id: 1,
            title: 'Мастерская',
            description: '',
            logo_url: '',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      if (sql.startsWith('SELECT * FROM brands WHERE'))
        return result([{ id: 1, title: 'Мастерская', description: '', logo_url: '' }]);
      if (sql.startsWith('INSERT INTO brands'))
        return result([{ id: 2, title: 'Новый бренд', description: '', logo_url: '' }]);
      if (sql.startsWith('UPDATE brands'))
        return result([{ id: 2, title: 'Обновлённый бренд', description: '', logo_url: '' }]);
      if (sql.startsWith('DELETE FROM brands')) return { rows: [], rowCount: 1 };
      return result([]);
    });
    const list = await authenticated(token).get('/api/v1/brands?limit=1');
    expect(list.status).toBe(200);
    expect(list.body.totalCount).toBe(2);
    expect(list.body.nextPage).toContain('offset=1');
    expect(list.body.items[0].logoUrl).toBe('');
    expect((await authenticated(token).get('/api/v1/brands/1')).status).toBe(200);
    expect(
      (await authenticated(token).post('/api/v1/brands').send({ title: 'Новый бренд' })).status,
    ).toBe(201);
    expect(
      (await authenticated(token).patch('/api/v1/brands/2').send({ title: 'Обновлённый бренд' }))
        .status,
    ).toBe(200);
    expect(
      (await authenticated(token).patch('/api/v1/brands/2').send({ unknown: 'поле' })).status,
    ).toBe(400);
    expect((await authenticated(token).delete('/api/v1/brands/2')).status).toBe(204);
    expect((await authenticated(token).get('/api/v1/brands/invalid')).status).toBe(400);
  });

  it('creates and updates a shop, publishes its catalogue and exposes only published shops', async () => {
    const owner = await tokenFor(ownerUser);
    const shop = {
      id: shopId,
      title: 'Лист и Лён',
      slug: 'list-i-len-ab12cd',
      category: 'Авторские товары',
      template: 'atelier',
      status: 'draft',
      settings: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO shops')) return result([shop]);
      return result([]);
    });
    const created = await authenticated(owner)
      .post('/api/v1/shops')
      .send({ title: 'Лист и Лён', category: 'Авторские товары' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toMatch(/^list-i-len-/);
    const publicSlug = created.body.slug as string;

    mocks.databaseQuery.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
      if (sql.startsWith('UPDATE shops SET')) return result([{ ...shop, status: 'published' }]);
      if (sql.startsWith('SELECT id, title, slug, category, template, settings FROM shops'))
        return parameters[0] === publicSlug ? result([{ ...shop, slug: publicSlug }]) : result([]);
      if (sql.startsWith('SELECT id, name, description, price'))
        return result([{ id: 1, name: 'Товар', price: '850.00' }]);
      return result([]);
    });
    expect(
      (
        await authenticated(owner)
          .patch(`/api/v1/shops/${shopId}`)
          .send({ settings: { heroTitle: 'Новая коллекция' } })
      ).status,
    ).toBe(200);
    expect((await authenticated(owner).post(`/api/v1/shops/${shopId}/publish`)).status).toBe(200);
    expect(
      (await request(server).get(`/api/v1/public/shops/${publicSlug}`)).body.goods,
    ).toHaveLength(1);
    expect((await request(server).get('/api/v1/public/shops/not-published')).status).toBe(404);
    expect((await authenticated(owner).get(`/api/v1/shops/${shopId}/orders`)).body.items).toEqual(
      [],
    );
  });

  it('supports buyer recipients, basket operations and checkout snapshots', async () => {
    const token = await tokenFor(ownerUser);
    mocks.databaseQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id, stock_count')) return result([{ id: 11, stock_count: 5 }]);
      if (sql.startsWith('INSERT INTO basket_items'))
        return result([{ id: 4, goodId: 11, count: 2 }]);
      if (sql.startsWith('UPDATE basket_items')) return result([{ id: 4, goodId: 11, count: 3 }]);
      if (sql.startsWith('DELETE FROM basket_items')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('DELETE FROM recipients')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT id, user_id AS "userId"'))
        return result([{ id: 6, userId: ownerUser.id, firstName: 'Александр' }]);
      if (sql.startsWith('INSERT INTO recipients'))
        return result([{ id: 6, userId: ownerUser.id, firstName: 'Александр' }]);
      if (sql.startsWith('SELECT id, created_at AS "createdAt"')) return result([{ id: shopId }]);
      if (sql.startsWith('SELECT t.id, t.created_at')) return result([{ id: shopId }]);
      return result([]);
    });
    expect((await authenticated(token).get('/api/v1/me/basket-items')).status).toBe(200);
    expect(
      (await authenticated(token).post('/api/v1/me/basket-items').send({ goodId: 11, count: 2 }))
        .status,
    ).toBe(201);
    expect(
      (await authenticated(token).patch('/api/v1/me/basket-items/4').send({ count: 3 })).status,
    ).toBe(200);
    expect((await authenticated(token).delete('/api/v1/me/basket-items/4')).status).toBe(204);
    expect((await authenticated(token).get('/api/v1/me/recipients')).status).toBe(200);
    expect(
      (
        await authenticated(token).post('/api/v1/me/recipients').send({
          firstName: 'Александр',
          lastName: 'Алфеев',
          address: 'Екатеринбург',
          zipCode: '620000',
          phone: '+79990000000',
        })
      ).status,
    ).toBe(201);
    expect((await authenticated(token).delete('/api/v1/me/recipients/6')).status).toBe(204);

    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id, user_id AS'))
        return result([
          { id: 6, userId: ownerUser.id, firstName: 'Александр', lastName: 'Алфеев' },
        ]);
      if (sql.includes('EXISTS(SELECT 1 FROM payment_methods'))
        return result([{ payment_available: true, delivery_available: true }]);
      if (sql.includes('SELECT b.good_id AS'))
        return result([
          { goodId: 11, count: 2, name: 'Чашка', price: '500.00', shopId, stockCount: 5 },
        ]);
      if (sql.includes('SELECT COALESCE(SUM')) return result([{ amount: '1000.00' }]);
      if (sql.startsWith('INSERT INTO checkouts'))
        return result([
          { id: 'checkout-1', created_at: new Date(), updated_at: new Date(), amount: '1000.00' },
        ]);
      if (sql.startsWith('INSERT INTO transactions'))
        return result([
          {
            id: 'transaction-1',
            created: new Date(),
            updated: new Date(),
            status: 'PENDING',
            amount: '1000.00',
            checkoutId: 'checkout-1',
            providerData: {},
          },
        ]);
      return result([]);
    });
    const checkout = await authenticated(token)
      .post('/api/v1/me/checkouts')
      .send({ recipientId: 6, paymentMethodId: 1, deliveryMethodId: 1 });
    expect(checkout.status).toBe(201);
    expect(checkout.body.transaction.status).toBe('PENDING');
    expect((await authenticated(token).get('/api/v1/me/checkouts')).status).toBe(200);
    expect((await authenticated(token).get('/api/v1/me/transactions')).status).toBe(200);
  });
});
