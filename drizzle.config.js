import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// dotenv defaults to `.env` only; Vercel's local convention is `.env.local`.
config({ path: '.env.local' });
config({ path: '.env' });

// DDL operations (push, generate, migrate) need a direct connection — pgbouncer
// breaks transaction-level DDL. The unpooled URL points at the same Neon
// database without the pooler in front.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set in .env.local');
}

export default defineConfig({
  schema: './db/schema.js',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
