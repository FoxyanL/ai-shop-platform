import pg from 'pg';
import { Redis } from 'ioredis';
import { config } from '../config.js';

export const database = new pg.Pool({ connectionString: config.DATABASE_URL });
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });

export async function publishEvent(type: string, data: Record<string, unknown>) {
  await redis.xadd('shop-platform:events', '*', 'type', type, 'data', JSON.stringify(data));
}

export async function closeConnections() {
  await Promise.all([database.end(), redis.quit()]);
}
