import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { redis } from '../db/pool.js';

const accessSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeSeconds = 30 * 24 * 60 * 60;

export interface AuthIdentity {
  id: string;
  email: string;
  role: 'platform_admin' | 'shop_owner' | 'shop_manager' | 'customer';
}

export async function createAccessToken(identity: AuthIdentity) {
  return new SignJWT({ email: identity.email, role: identity.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.id)
    .setIssuedAt()
    .setExpirationTime(`${accessLifetimeSeconds}s`)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AuthIdentity> {
  const { payload } = await jwtVerify(token, accessSecret);
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    !['platform_admin', 'shop_owner', 'shop_manager', 'customer'].includes(String(payload.role))
  ) {
    throw new Error('Некорректный токен доступа');
  }
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role as AuthIdentity['role'],
  };
}

function digestRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createRefreshSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await redis.set(`session:${digestRefreshToken(token)}`, userId, 'EX', refreshLifetimeSeconds);
  return token;
}

export async function readRefreshSession(token: string) {
  return redis.get(`session:${digestRefreshToken(token)}`);
}

export async function revokeRefreshSession(token: string) {
  await redis.del(`session:${digestRefreshToken(token)}`);
}
