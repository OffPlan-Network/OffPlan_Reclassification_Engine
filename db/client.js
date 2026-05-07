import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

// Vercel Functions inject DATABASE_URL at runtime. For local development with
// `vercel dev`, the same env var is sourced from .env.local. The HTTP driver
// is used everywhere because it works in both Node and Edge runtimes and
// avoids the cold-start connection issues of the regular pg driver on
// serverless platforms.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Add it to .env.local for local dev or to ' +
      "Vercel's Environment Variables for deployments.",
  );
}

const sql = neon(url);
export const db = drizzle(sql, { schema });
export { schema };
