import Router from '@koa/router';
import { z, type ZodType } from 'zod';
import { database } from '../db/pool.js';
import { authenticate, requireRoles } from '../middleware/authenticate.js';
import { fail } from '../middleware/fail.js';

type Resource = {
  table: string;
  idKind?: 'number' | 'uuid';
  fields: Record<string, { column: string; schema: ZodType }>;
  roles: string[];
  shopScoped?: boolean;
};

const nonEmpty = z.string().trim().min(1).max(500);
const text = z.string().trim().max(5000);
const positiveId = z.coerce.number().int().positive();
const optionalShopId = z.string().uuid().nullable().optional();

const resources: Record<string, Resource> = {
  news: {
    table: 'news',
    fields: {
      title: { column: 'title', schema: nonEmpty },
      slug: { column: 'slug', schema: z.string().trim().min(1).max(160).optional() },
      summary: { column: 'summary', schema: text.optional() },
      body: { column: 'body', schema: text.optional() },
      published: { column: 'published', schema: z.boolean().optional() },
    },
    roles: ['platform_admin'],
  },
  users: {
    table: 'users',
    idKind: 'uuid',
    fields: {
      email: {
        column: 'email',
        schema: z
          .string()
          .email()
          .transform((value) => value.toLowerCase()),
      },
      firstName: { column: 'first_name', schema: text.optional() },
      lastName: { column: 'last_name', schema: text.optional() },
      role: {
        column: 'role',
        schema: z.enum(['platform_admin', 'shop_owner', 'shop_manager', 'customer']).optional(),
      },
      isActive: { column: 'is_active', schema: z.boolean().optional() },
    },
    roles: ['platform_admin'],
  },
  brands: {
    table: 'brands',
    fields: {
      title: { column: 'title', schema: nonEmpty },
      description: { column: 'description', schema: text.optional() },
      logoUrl: { column: 'logo_url', schema: z.string().url().or(z.literal('')).optional() },
    },
    roles: ['platform_admin'],
  },
  sizes: {
    table: 'sizes',
    fields: {
      title: { column: 'title', schema: nonEmpty },
      code: { column: 'code', schema: text.optional() },
    },
    roles: ['platform_admin'],
  },
  'good-categories': {
    table: 'good_categories',
    shopScoped: true,
    fields: {
      shopId: { column: 'shop_id', schema: optionalShopId },
      title: { column: 'title', schema: nonEmpty },
      description: { column: 'description', schema: text.optional() },
      parentId: { column: 'parent_id', schema: positiveId.nullable().optional() },
    },
    roles: ['platform_admin', 'shop_owner', 'shop_manager'],
  },
  goods: {
    table: 'goods',
    shopScoped: true,
    fields: {
      shopId: { column: 'shop_id', schema: optionalShopId },
      name: { column: 'name', schema: nonEmpty },
      description: { column: 'description', schema: text.optional() },
      price: { column: 'price', schema: z.coerce.number().nonnegative().optional() },
      categoryId: { column: 'category_id', schema: positiveId.nullable().optional() },
      brandId: { column: 'brand_id', schema: positiveId.nullable().optional() },
      sizeIds: { column: 'size_ids', schema: z.array(positiveId).optional() },
      stockCount: {
        column: 'stock_count',
        schema: z.coerce.number().int().nonnegative().optional(),
      },
      published: { column: 'published', schema: z.boolean().optional() },
    },
    roles: ['platform_admin', 'shop_owner', 'shop_manager'],
  },
  'payment-methods': {
    table: 'payment_methods',
    fields: {
      title: { column: 'title', schema: nonEmpty },
      description: { column: 'description', schema: text.optional() },
      logoUrl: { column: 'logo_url', schema: z.string().url().or(z.literal('')).optional() },
      isActive: { column: 'is_active', schema: z.boolean().optional() },
    },
    roles: ['platform_admin'],
  },
  'delivery-methods': {
    table: 'delivery_methods',
    fields: {
      title: { column: 'title', schema: nonEmpty },
      description: { column: 'description', schema: text.optional() },
      logoUrl: { column: 'logo_url', schema: z.string().url().or(z.literal('')).optional() },
      isActive: { column: 'is_active', schema: z.boolean().optional() },
    },
    roles: ['platform_admin'],
  },
  recipients: {
    table: 'recipients',
    fields: {
      userId: { column: 'user_id', schema: z.string().uuid() },
      firstName: { column: 'first_name', schema: nonEmpty },
      lastName: { column: 'last_name', schema: nonEmpty },
      middleName: { column: 'middle_name', schema: text.optional() },
      address: { column: 'address', schema: nonEmpty },
      zipCode: { column: 'zip_code', schema: nonEmpty },
      phone: { column: 'phone', schema: nonEmpty },
    },
    roles: ['platform_admin'],
  },
};

const router = new Router();

function makeSchema(resource: Resource, partial: boolean) {
  const shape = Object.fromEntries(
    Object.entries(resource.fields).map(([key, value]) => [key, value.schema]),
  );
  const schema = z.object(shape).strict();
  return partial ? schema.partial() : schema;
}

function toApiRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

function parseId(id: string, resource: Resource) {
  if (resource.idKind === 'uuid') {
    if (!z.string().uuid().safeParse(id).success) return null;
    return id;
  }
  const number = Number(id);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function toDatabaseFields(resource: Resource, data: Record<string, unknown>) {
  return Object.entries(data).map(([key, value]) => ({
    column: resource.fields[key]!.column,
    value,
  }));
}

async function getScope(userId: string, isAdmin: boolean, resource: Resource) {
  if (!resource.shopScoped || isAdmin) return { clause: '', values: [] as unknown[] };
  return {
    clause: 'shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = $1)',
    values: [userId],
  };
}

router.use(authenticate);

for (const [path, resource] of Object.entries(resources)) {
  const roleGuard = requireRoles(...resource.roles);
  router.get(`/${path}`, roleGuard, async (ctx) => {
    const limit = Math.min(Math.max(Number(ctx.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(ctx.query.offset) || 0, 0);
    const scope = await getScope(
      ctx.state.user!.id,
      ctx.state.user!.role === 'platform_admin',
      resource,
    );
    const clauses = scope.clause ? [scope.clause] : [];
    const values = [...scope.values];
    if (resource.shopScoped && typeof ctx.query.shopId === 'string') {
      const shopId = z.string().uuid().safeParse(ctx.query.shopId);
      if (!shopId.success) fail(ctx, 400, 'Некорректный идентификатор магазина');
      if (ctx.state.user!.role !== 'platform_admin') {
        const membership = await database.query(
          'SELECT 1 FROM shop_members WHERE shop_id = $1 AND user_id = $2',
          [shopId.data, ctx.state.user!.id],
        );
        if (!membership.rowCount) fail(ctx, 403, 'Нет доступа к этому магазину');
      }
      values.push(shopId.data);
      clauses.push(`shop_id = $${values.length}`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const count = await database.query(
      `SELECT COUNT(*)::int AS count FROM ${resource.table}${where}`,
      values,
    );
    const rows = await database.query(
      `SELECT * FROM ${resource.table}${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const totalCount = Number(count.rows[0].count);
    const queryPath = `/api/v1/${path}`;
    ctx.body = {
      totalCount,
      nextPage:
        offset + limit < totalCount ? `${queryPath}?limit=${limit}&offset=${offset + limit}` : null,
      prevPage:
        offset > 0 ? `${queryPath}?limit=${limit}&offset=${Math.max(0, offset - limit)}` : null,
      items: rows.rows.map(toApiRow),
    };
  });

  router.get(`/${path}/:id`, roleGuard, async (ctx) => {
    const rawId = ctx.params.id;
    if (!rawId) fail(ctx, 400, 'Некорректный идентификатор');
    const id = parseId(rawId, resource);
    if (id === null) fail(ctx, 400, 'Некорректный идентификатор');
    const values: unknown[] = [id];
    let where = 'id = $1';
    if (resource.shopScoped && ctx.state.user!.role !== 'platform_admin') {
      values.push(ctx.state.user!.id);
      where += ` AND shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length})`;
    }
    const result = await database.query(`SELECT * FROM ${resource.table} WHERE ${where}`, values);
    if (!result.rowCount) fail(ctx, 404, 'Запись не найдена');
    ctx.body = toApiRow(result.rows[0]);
  });

  router.post(`/${path}`, roleGuard, async (ctx) => {
    const parsed = makeSchema(resource, false).safeParse(ctx.request.body);
    if (!parsed.success) fail(ctx, 400, 'Проверьте обязательные поля');
    const data = { ...parsed.data } as Record<string, unknown>;
    if ('slug' in resource.fields && !data.slug && data.title) {
      data.slug = String(data.title)
        .toLocaleLowerCase('ru')
        .replace(/[^a-zа-яё0-9]+/gi, '-')
        .replace(/(^-|-$)/g, '');
    }
    if (resource.shopScoped) {
      if (typeof data.shopId !== 'string') {
        if (ctx.state.user!.role !== 'platform_admin') fail(ctx, 400, 'Укажите магазин');
      } else {
        const shop = await database.query('SELECT id FROM shops WHERE id = $1', [data.shopId]);
        if (!shop.rowCount) fail(ctx, 404, 'Магазин не найден');
        if (ctx.state.user!.role !== 'platform_admin') {
          const membership = await database.query(
            'SELECT 1 FROM shop_members WHERE shop_id = $1 AND user_id = $2',
            [data.shopId, ctx.state.user!.id],
          );
          if (!membership.rowCount) fail(ctx, 403, 'Нет доступа к этому магазину');
        }
      }
    }
    const fields = toDatabaseFields(resource, data);
    const columns = fields.map((field) => field.column);
    const placeholders = fields.map((_, index) => `$${index + 1}`);
    const values = fields.map((field) => field.value);
    const result = await database.query(
      `INSERT INTO ${resource.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values,
    );
    ctx.status = 201;
    ctx.body = toApiRow(result.rows[0]);
  });

  router.patch(`/${path}/:id`, roleGuard, async (ctx) => {
    const rawId = ctx.params.id;
    if (!rawId) fail(ctx, 400, 'Некорректный идентификатор');
    const id = parseId(rawId, resource);
    if (id === null) fail(ctx, 400, 'Некорректный идентификатор');
    const parsed = makeSchema(resource, true).safeParse(ctx.request.body);
    if (!parsed.success) fail(ctx, 400, 'Передайте корректные поля для изменения');
    if (Object.keys(parsed.data).length === 0) fail(ctx, 400, 'Передайте поля для изменения');
    const data = parsed.data as Record<string, unknown>;
    if (resource.shopScoped && typeof data.shopId === 'string') {
      const shop = await database.query('SELECT id FROM shops WHERE id = $1', [data.shopId]);
      if (!shop.rowCount) fail(ctx, 404, 'Магазин не найден');
      if (ctx.state.user!.role !== 'platform_admin') {
        const membership = await database.query(
          'SELECT 1 FROM shop_members WHERE shop_id = $1 AND user_id = $2',
          [data.shopId, ctx.state.user!.id],
        );
        if (!membership.rowCount) fail(ctx, 403, 'Нет доступа к этому магазину');
      }
    }
    const fields = toDatabaseFields(resource, data);
    const values: unknown[] = fields.map((field) => field.value);
    const assignments = fields.map((field, index) => `${field.column} = $${index + 1}`);
    assignments.push('updated_at = NOW()');
    values.push(id);
    let where = `id = $${values.length}`;
    if (resource.shopScoped && ctx.state.user!.role !== 'platform_admin') {
      values.push(ctx.state.user!.id);
      where += ` AND shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length})`;
    }
    const result = await database.query(
      `UPDATE ${resource.table} SET ${assignments.join(', ')} WHERE ${where} RETURNING *`,
      values,
    );
    if (!result.rowCount) fail(ctx, 404, 'Запись не найдена');
    ctx.body = toApiRow(result.rows[0]);
  });

  router.delete(`/${path}/:id`, roleGuard, async (ctx) => {
    const rawId = ctx.params.id;
    if (!rawId) fail(ctx, 400, 'Некорректный идентификатор');
    const id = parseId(rawId, resource);
    if (id === null) fail(ctx, 400, 'Некорректный идентификатор');
    const values: unknown[] = [id];
    let where = 'id = $1';
    if (resource.shopScoped && ctx.state.user!.role !== 'platform_admin') {
      values.push(ctx.state.user!.id);
      where += ` AND shop_id IN (SELECT shop_id FROM shop_members WHERE user_id = $${values.length})`;
    }
    const result = await database.query(`DELETE FROM ${resource.table} WHERE ${where}`, values);
    if (!result.rowCount) fail(ctx, 404, 'Запись не найдена');
    ctx.status = 204;
  });
}

export const resourceRouter = router;
