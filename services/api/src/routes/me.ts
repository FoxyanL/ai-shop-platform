import Router from '@koa/router';
import { z } from 'zod';
import { database, publishEvent } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { fail } from '../middleware/fail.js';

export const meRouter = new Router({ prefix: '/me' });
meRouter.use(authenticate);

meRouter.get('/basket-items', async (ctx) => {
  const result = await database.query(
    `SELECT b.id, b.good_id AS "goodId", b.count, g.name, g.price, g.shop_id AS "shopId",
            g.stock_count AS "stockCount", (g.price * b.count)::numeric(12, 2) AS "lineTotal"
     FROM basket_items b JOIN goods g ON g.id = b.good_id WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [ctx.state.user!.id],
  );
  ctx.body = { items: result.rows };
});

meRouter.post('/basket-items', async (ctx) => {
  const parsed = z
    .object({
      goodId: z.coerce.number().int().positive(),
      count: z.coerce.number().int().positive().max(999),
    })
    .safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Укажите товар и количество');
  const product = await database.query(
    'SELECT id, stock_count FROM goods WHERE id = $1 AND published = TRUE',
    [parsed.data.goodId],
  );
  if (!product.rowCount) fail(ctx, 404, 'Товар не найден');
  if (product.rows[0].stock_count < parsed.data.count)
    fail(ctx, 409, 'На складе недостаточно товара');
  const result = await database.query(
    `INSERT INTO basket_items (user_id, good_id, count) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, good_id) DO UPDATE SET count = EXCLUDED.count, updated_at = NOW()
     RETURNING id, good_id AS "goodId", count`,
    [ctx.state.user!.id, parsed.data.goodId, parsed.data.count],
  );
  ctx.status = 201;
  ctx.body = result.rows[0];
});

meRouter.patch('/basket-items/:id', async (ctx) => {
  const parsed = z
    .object({ count: z.coerce.number().int().positive().max(999) })
    .safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Количество должно быть положительным числом');
  const result = await database.query(
    `UPDATE basket_items SET count = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
       AND $1 <= (SELECT stock_count FROM goods WHERE goods.id = basket_items.good_id)
     RETURNING id, good_id AS "goodId", count`,
    [parsed.data.count, ctx.params.id, ctx.state.user!.id],
  );
  if (!result.rowCount) fail(ctx, 404, 'Позиция корзины не найдена или недостаточно товара');
  ctx.body = result.rows[0];
});

meRouter.delete('/basket-items/:id', async (ctx) => {
  const result = await database.query('DELETE FROM basket_items WHERE id = $1 AND user_id = $2', [
    ctx.params.id,
    ctx.state.user!.id,
  ]);
  if (!result.rowCount) fail(ctx, 404, 'Позиция корзины не найдена');
  ctx.status = 204;
});

meRouter.get('/recipients', async (ctx) => {
  const result = await database.query(
    `SELECT id, user_id AS "userId", first_name AS "firstName", last_name AS "lastName",
     middle_name AS "middleName", address, zip_code AS "zipCode", phone, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM recipients WHERE user_id = $1 ORDER BY created_at DESC`,
    [ctx.state.user!.id],
  );
  ctx.body = { items: result.rows };
});

meRouter.get('/recipients/:id', async (ctx) => {
  const result = await database.query(
    `SELECT id, user_id AS "userId", first_name AS "firstName", last_name AS "lastName",
     middle_name AS "middleName", address, zip_code AS "zipCode", phone, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM recipients WHERE id = $1 AND user_id = $2`,
    [ctx.params.id, ctx.state.user!.id],
  );
  if (!result.rowCount) fail(ctx, 404, 'Получатель не найден');
  ctx.body = result.rows[0];
});

meRouter.post('/recipients', async (ctx) => {
  const parsed = z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      middleName: z.string().trim().max(100).optional(),
      address: z.string().trim().min(5).max(500),
      zipCode: z.string().trim().min(3).max(20),
      phone: z.string().trim().min(6).max(30),
    })
    .safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Проверьте контактные данные и адрес получателя');
  const result = await database.query(
    `INSERT INTO recipients (user_id, first_name, last_name, middle_name, address, zip_code, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id AS "userId", first_name AS "firstName", last_name AS "lastName",
     middle_name AS "middleName", address, zip_code AS "zipCode", phone, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      ctx.state.user!.id,
      parsed.data.firstName,
      parsed.data.lastName,
      parsed.data.middleName ?? '',
      parsed.data.address,
      parsed.data.zipCode,
      parsed.data.phone,
    ],
  );
  ctx.status = 201;
  ctx.body = result.rows[0];
});

meRouter.delete('/recipients/:id', async (ctx) => {
  const result = await database.query('DELETE FROM recipients WHERE id = $1 AND user_id = $2', [
    ctx.params.id,
    ctx.state.user!.id,
  ]);
  if (!result.rowCount) fail(ctx, 404, 'Получатель не найден');
  ctx.status = 204;
});

meRouter.post('/checkouts', async (ctx) => {
  const parsed = z
    .object({
      recipientId: z.coerce.number().int().positive(),
      paymentMethodId: z.coerce.number().int().positive(),
      deliveryMethodId: z.coerce.number().int().positive(),
    })
    .safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Укажите получателя, оплату и доставку');
  const client = await database.connect();
  let checkoutId = '';
  let transaction: Record<string, unknown>;
  try {
    await client.query('BEGIN');
    const recipient = await client.query(
      `SELECT id, user_id AS "userId", first_name AS "firstName", last_name AS "lastName",
       middle_name AS "middleName", address, zip_code AS "zipCode", phone
       FROM recipients WHERE id = $1 AND user_id = $2 FOR SHARE`,
      [parsed.data.recipientId, ctx.state.user!.id],
    );
    if (!recipient.rowCount) fail(ctx, 404, 'Получатель не найден');
    const methods = await client.query(
      `SELECT
       EXISTS(SELECT 1 FROM payment_methods WHERE id = $1 AND is_active = TRUE) AS payment_available,
       EXISTS(SELECT 1 FROM delivery_methods WHERE id = $2 AND is_active = TRUE) AS delivery_available`,
      [parsed.data.paymentMethodId, parsed.data.deliveryMethodId],
    );
    if (!methods.rows[0].payment_available || !methods.rows[0].delivery_available)
      fail(ctx, 400, 'Выбранный способ оплаты или доставки недоступен');
    const basket = await client.query(
      `SELECT b.good_id AS "goodId", b.count, g.name, g.description, g.price,
              g.shop_id AS "shopId", g.stock_count AS "stockCount"
       FROM basket_items b JOIN goods g ON g.id = b.good_id
       WHERE b.user_id = $1 AND g.published = TRUE FOR UPDATE OF b, g`,
      [ctx.state.user!.id],
    );
    if (!basket.rowCount) fail(ctx, 400, 'Корзина пуста');
    if (basket.rows.some((item) => item.count > item.stockCount))
      fail(ctx, 409, 'Недостаточно товара на складе');
    const shopIds = new Set(basket.rows.map((item) => item.shopId).filter(Boolean));
    if (shopIds.size > 1) fail(ctx, 400, 'Оформите товары из каждого магазина отдельным заказом');
    const amountResult = await client.query(
      `SELECT COALESCE(SUM(g.price * b.count), 0)::numeric(12, 2) AS amount
       FROM basket_items b JOIN goods g ON g.id = b.good_id WHERE b.user_id = $1`,
      [ctx.state.user!.id],
    );
    const amount = amountResult.rows[0].amount as string;
    const checkout = await client.query(
      `INSERT INTO checkouts (user_id, shop_id, recipient_snapshot, basket_snapshot, payment_method_id, delivery_method_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at, updated_at, amount`,
      [
        ctx.state.user!.id,
        [...shopIds][0] ?? null,
        JSON.stringify(recipient.rows[0]),
        JSON.stringify(basket.rows),
        parsed.data.paymentMethodId,
        parsed.data.deliveryMethodId,
        amount,
      ],
    );
    checkoutId = checkout.rows[0].id;
    const createdTransaction = await client.query(
      `INSERT INTO transactions (checkout_id, status, amount, provider_data)
       VALUES ($1, 'PENDING', $2, '{}'::jsonb)
       RETURNING id, created_at AS "created", updated_at AS "updated", status, amount, checkout_id AS "checkoutId", provider_data AS "providerData"`,
      [checkoutId, amount],
    );
    transaction = createdTransaction.rows[0];
    await client.query('DELETE FROM basket_items WHERE user_id = $1', [ctx.state.user!.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await publishEvent('checkout.created', {
    checkoutId,
    transactionId: transaction.id,
    userId: ctx.state.user!.id,
  });
  ctx.status = 201;
  ctx.body = { id: checkoutId, transaction };
});

meRouter.get('/checkouts', async (ctx) => {
  const result = await database.query(
    `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt", amount,
            payment_method_id AS "paymentMethodId", delivery_method_id AS "deliveryMethodId"
     FROM checkouts WHERE user_id = $1 ORDER BY created_at DESC`,
    [ctx.state.user!.id],
  );
  ctx.body = { items: result.rows };
});

meRouter.get('/transactions', async (ctx) => {
  const result = await database.query(
    `SELECT t.id, t.created_at AS "created", t.updated_at AS "updated", t.status, t.amount,
            t.checkout_id AS "checkoutId", t.provider_data AS "providerData"
     FROM transactions t JOIN checkouts c ON c.id = t.checkout_id
     WHERE c.user_id = $1 ORDER BY t.created_at DESC`,
    [ctx.state.user!.id],
  );
  ctx.body = { items: result.rows };
});
