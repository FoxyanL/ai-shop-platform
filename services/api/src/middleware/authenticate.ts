import type { Middleware } from 'koa';
import { verifyAccessToken } from '../security/tokens.js';

export const authenticate: Middleware = async (ctx, next) => {
  const authorization = ctx.get('authorization');
  if (!authorization.startsWith('Bearer ')) {
    ctx.throw(401, 'Требуется авторизация');
  }

  try {
    ctx.state.user = await verifyAccessToken(authorization.slice(7));
  } catch {
    ctx.throw(401, 'Токен доступа недействителен или истёк');
  }

  await next();
};

export function requireRoles(...roles: string[]): Middleware {
  return async (ctx, next) => {
    if (!ctx.state.user || !roles.includes(ctx.state.user.role)) {
      ctx.throw(403, 'Недостаточно прав для выполнения операции');
    }
    await next();
  };
}
