import { randomBytes } from 'node:crypto';
import Router from '@koa/router';
import { z } from 'zod';
import { database } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { fail } from '../middleware/fail.js';

export const shopRouter = new Router({ prefix: '/shops' });
const shopInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().max(120).optional(),
  template: z.enum(['atelier', 'market', 'flora']).optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60)
    .optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const transliteration: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
function makeSlug(title: string) {
  return title
    .toLocaleLowerCase('ru')
    .replace(/[а-яё]/g, (letter) => transliteration[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

shopRouter.use(authenticate);

shopRouter.get('/', async (ctx) => {
  const result =
    ctx.state.user!.role === 'platform_admin'
      ? await database.query('SELECT * FROM shops ORDER BY created_at DESC')
      : await database.query(
          `SELECT s.* FROM shops s
         JOIN shop_members m ON m.shop_id = s.id
         WHERE m.user_id = $1 ORDER BY s.created_at DESC`,
          [ctx.state.user!.id],
        );
  ctx.body = {
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category,
      template: row.template,
      status: row.status,
      settings: row.settings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

shopRouter.get('/:id/orders', async (ctx) => {
  const values: unknown[] = [ctx.params.id];
  let where = 'c.shop_id = $1';
  if (ctx.state.user!.role !== 'platform_admin') {
    values.push(ctx.state.user!.id);
    where += ` AND c.shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length})`;
  }
  const result = await database.query(
    `SELECT t.id, t.checkout_id AS "checkoutId", t.status, t.amount,
            t.created_at AS "createdAt", c.recipient_snapshot AS recipient,
            c.basket_snapshot AS items, c.payment_method_id AS "paymentMethodId",
            c.delivery_method_id AS "deliveryMethodId"
     FROM transactions t JOIN checkouts c ON c.id = t.checkout_id
     WHERE ${where} ORDER BY t.created_at DESC`,
    values,
  );
  ctx.body = { items: result.rows };
});

shopRouter.post('/', async (ctx) => {
  if (!['platform_admin', 'shop_owner'].includes(ctx.state.user!.role)) {
    fail(ctx, 403, 'Создавать магазин может владелец рабочего пространства');
  }
  const parsed = shopInput.safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Проверьте название, категорию и адрес магазина');
  const requestedSlug = parsed.data.slug ?? makeSlug(parsed.data.title);
  const slug = `${requestedSlug || 'shop'}-${randomBytes(3).toString('hex')}`;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO shops (owner_id, title, slug, category, template, settings)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        ctx.state.user!.id,
        parsed.data.title,
        slug,
        parsed.data.category ?? '',
        parsed.data.template ?? 'atelier',
        JSON.stringify(parsed.data.settings ?? {}),
      ],
    );
    const shop = result.rows[0];
    await client.query(
      `INSERT INTO shop_members (shop_id, user_id, role) VALUES ($1, $2, 'shop_owner')
       ON CONFLICT (shop_id, user_id) DO NOTHING`,
      [shop.id, ctx.state.user!.id],
    );
    await client.query('COMMIT');
    ctx.status = 201;
    ctx.body = {
      id: shop.id,
      title: shop.title,
      slug: shop.slug,
      category: shop.category,
      template: shop.template,
      status: shop.status,
      settings: shop.settings,
      createdAt: shop.created_at,
      updatedAt: shop.updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

shopRouter.patch('/:id', async (ctx) => {
  if (ctx.state.user!.role !== 'platform_admin' && ctx.state.user!.role !== 'shop_owner') {
    fail(ctx, 403, 'Настраивать витрину может владелец магазина');
  }
  const parsed = shopInput.partial().strict().safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Передайте корректные поля для изменения');
  if (Object.keys(parsed.data).length === 0) fail(ctx, 400, 'Передайте поля для изменения');
  const values: unknown[] = [];
  const changes: string[] = [];
  const columns: Record<string, string> = {
    title: 'title',
    category: 'category',
    template: 'template',
    slug: 'slug',
    settings: 'settings',
  };
  for (const [key, value] of Object.entries(parsed.data)) {
    const column = columns[key];
    if (!column) continue;
    values.push(key === 'settings' ? JSON.stringify(value) : value);
    changes.push(`${column} = $${values.length}`);
  }
  values.push(ctx.params.id);
  let where = `id = $${values.length}`;
  if (ctx.state.user!.role !== 'platform_admin') {
    values.push(ctx.state.user!.id);
    where += ` AND id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length} AND role = 'shop_owner')`;
  }
  const result = await database.query(
    `UPDATE shops SET ${changes.join(', ')}, updated_at = NOW() WHERE ${where} RETURNING *`,
    values,
  );
  if (!result.rowCount) fail(ctx, 404, 'Магазин не найден');
  const shop = result.rows[0];
  ctx.body = {
    id: shop.id,
    title: shop.title,
    slug: shop.slug,
    category: shop.category,
    template: shop.template,
    status: shop.status,
    settings: shop.settings,
    createdAt: shop.created_at,
    updatedAt: shop.updated_at,
  };
});

shopRouter.post('/:id/publish', async (ctx) => {
  const values: unknown[] = [ctx.params.id];
  let where = 'id = $1';
  if (ctx.state.user!.role !== 'platform_admin') {
    values.push(ctx.state.user!.id);
    where += ` AND id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length} AND role = 'shop_owner')`;
  }
  const result = await database.query(
    `UPDATE shops SET status = 'published', updated_at = NOW() WHERE ${where} RETURNING id, title, slug, status, updated_at`,
    values,
  );
  if (!result.rowCount) fail(ctx, 404, 'Магазин не найден или публикация недоступна');
  const shop = result.rows[0];
  ctx.body = {
    id: shop.id,
    title: shop.title,
    slug: shop.slug,
    status: shop.status,
    updatedAt: shop.updated_at,
  };
});

export const publicShopRouter = new Router({ prefix: '/public/shops' });
publicShopRouter.get('/:slug', async (ctx) => {
  const shop = await database.query(
    "SELECT id, title, slug, category, template, settings FROM shops WHERE slug = $1 AND status = 'published'",
    [ctx.params.slug],
  );
  if (!shop.rowCount) fail(ctx, 404, 'Опубликованный магазин не найден');
  const goods = await database.query(
    'SELECT id, name, description, price, category_id AS "categoryId", brand_id AS "brandId", stock_count AS "stockCount" FROM goods WHERE shop_id = $1 AND published = TRUE ORDER BY created_at DESC',
    [shop.rows[0].id],
  );
  const [paymentMethods, deliveryMethods] = await Promise.all([
    database.query(
      'SELECT id, title, description, logo_url AS "logoUrl" FROM payment_methods WHERE is_active = TRUE ORDER BY id',
    ),
    database.query(
      'SELECT id, title, description, logo_url AS "logoUrl" FROM delivery_methods WHERE is_active = TRUE ORDER BY id',
    ),
  ]);
  ctx.body = {
    ...shop.rows[0],
    goods: goods.rows,
    paymentMethods: paymentMethods.rows,
    deliveryMethods: deliveryMethods.rows,
  };
});
