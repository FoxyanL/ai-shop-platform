import type { Context } from 'koa';

export function fail(ctx: Context, status: number, message: string): never {
  ctx.throw(status, message);
  throw new Error(message);
}
