import 'dotenv/config';
import { z } from 'zod';

const environment = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    ADMIN_ORIGIN: z.string().url().default('http://localhost:5173'),
    STOREFRONT_ORIGIN: z.string().url().default('http://localhost:3000'),
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    EMAIL_DEBUG_CODE: z
      .preprocess((value) => value === 'true' || value === true, z.boolean())
      .default(false),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('Мастерская <no-reply@example.test>'),
  })
  .parse(process.env);

export const config = {
  ...environment,
  isProduction: environment.NODE_ENV === 'production',
};
