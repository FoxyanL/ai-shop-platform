import { randomInt } from 'node:crypto';
import Router from '@koa/router';
import type { Context } from 'koa';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { config } from '../config.js';
import { database, redis } from '../db/pool.js';
import {
  createAccessToken,
  createRefreshSession,
  readRefreshSession,
  revokeRefreshSession,
} from '../security/tokens.js';
import { fail } from '../middleware/fail.js';

export const authRouter = new Router({ prefix: '/auth' });
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const confirmSchema = z.object({ email: emailSchema, otp: z.string().regex(/^\d{6}$/) });

async function sendCode(email: string, code: string) {
  if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD) {
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    });
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Код входа в Мастерскую',
      text: `Ваш одноразовый код: ${code}. Он действует 10 минут.`,
    });
    return;
  }
  if (config.NODE_ENV === 'production' || !config.EMAIL_DEBUG_CODE) {
    throw new Error('Почтовый сервер не настроен');
  }
  console.info(`Код подтверждения для ${email}: ${code}`);
}

async function issueCode(ctx: Context, email: string) {
  const limitKey = `otp-limit:${ctx.ip}:${email}`;
  const requests = await redis.incr(limitKey);
  if (requests === 1) await redis.expire(limitKey, 3600);
  if (requests > 5) fail(ctx, 429, 'Слишком много запросов кода. Попробуйте позже.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await redis.set(`otp:${email}`, code, 'EX', 600);
  await sendCode(email, code);
  ctx.status = 202;
  ctx.body = {
    message: 'Если адрес зарегистрирован, на него отправлен код подтверждения.',
    ...(config.NODE_ENV !== 'production' && config.EMAIL_DEBUG_CODE ? { debugCode: code } : {}),
  };
}

authRouter.post('/register', async (ctx) => {
  const parsed = z
    .object({
      email: emailSchema,
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      role: z.enum(['shop_owner', 'customer']).optional(),
    })
    .safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Проверьте адрес почты и имя');

  const existing = await database.query('SELECT id FROM users WHERE email = $1', [
    parsed.data.email,
  ]);
  if (existing.rowCount) fail(ctx, 409, 'Пользователь с таким адресом уже зарегистрирован');
  await database.query(
    'INSERT INTO users (email, first_name, last_name, role) VALUES ($1, $2, $3, $4)',
    [
      parsed.data.email,
      parsed.data.firstName,
      parsed.data.lastName,
      parsed.data.role ?? 'shop_owner',
    ],
  );
  await issueCode(ctx, parsed.data.email);
});

authRouter.post('/login', async (ctx) => {
  const parsed = z.object({ email: emailSchema }).safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Укажите корректный адрес электронной почты');
  const user = await database.query('SELECT id FROM users WHERE email = $1 AND is_active = TRUE', [
    parsed.data.email,
  ]);
  if (!user.rowCount) fail(ctx, 404, 'Аккаунт не найден. Сначала зарегистрируйтесь.');
  await issueCode(ctx, parsed.data.email);
});

authRouter.post('/confirm', async (ctx) => {
  const parsed = confirmSchema.safeParse(ctx.request.body);
  if (!parsed.success) fail(ctx, 400, 'Укажите адрес и шестизначный код из письма');
  const attemptsKey = `otp-attempts:${parsed.data.email}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, 600);
  if (attempts > 5) {
    await redis.del(`otp:${parsed.data.email}`);
    fail(ctx, 429, 'Превышено число попыток. Запросите новый код.');
  }
  const storedCode = await redis.get(`otp:${parsed.data.email}`);
  if (!storedCode || storedCode !== parsed.data.otp)
    fail(ctx, 400, 'Код недействителен или срок его действия истёк');

  const result = await database.query(
    `UPDATE users SET email_verified = TRUE, updated_at = NOW()
     WHERE email = $1 AND is_active = TRUE
     RETURNING id, email, role`,
    [parsed.data.email],
  );
  if (!result.rowCount) fail(ctx, 404, 'Аккаунт не найден');
  await redis.del(`otp:${parsed.data.email}`);
  await redis.del(attemptsKey);
  const user = result.rows[0] as {
    id: string;
    email: string;
    role: 'platform_admin' | 'shop_owner' | 'shop_manager' | 'customer';
  };
  const accessToken = await createAccessToken(user);
  const refreshToken = await createRefreshSession(user.id);
  ctx.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    overwrite: true,
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  ctx.body = { accessToken, user };
});

authRouter.post('/refresh', async (ctx) => {
  const token = ctx.cookies.get('refreshToken');
  if (!token) fail(ctx, 401, 'Сессия завершена');
  const userId = await readRefreshSession(token);
  if (!userId) fail(ctx, 401, 'Сессия завершена');
  const result = await database.query(
    'SELECT id, email, role FROM users WHERE id = $1 AND is_active = TRUE',
    [userId],
  );
  if (!result.rowCount) fail(ctx, 401, 'Аккаунт недоступен');
  const user = result.rows[0] as {
    id: string;
    email: string;
    role: 'platform_admin' | 'shop_owner' | 'shop_manager' | 'customer';
  };
  ctx.body = { accessToken: await createAccessToken(user), user };
});

authRouter.post('/logout', async (ctx) => {
  const token = ctx.cookies.get('refreshToken');
  if (token) await revokeRefreshSession(token);
  ctx.cookies.set('refreshToken', '', {
    httpOnly: true,
    secure: config.isProduction,
    path: '/api/v1/auth',
    maxAge: 0,
  });
  ctx.status = 204;
});
