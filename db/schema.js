import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// Single KV table that mirrors the existing src/storage.js interface 1:1.
// Keys keep their namespace shape (employer:<id>, claims:<id>, scenario:<id>,
// input_mode:<id>, global:pricing_versions, global:audit_log, etc.) so the
// app's read/write paths port over without any change to App.jsx.
//
// Structured per-domain tables (employers, claims, etc.) are deferred until
// query needs justify the schema work.
export const appData = pgTable(
  'app_data',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyPrefixIdx: index('app_data_key_prefix_idx').using('btree', t.key.op('text_pattern_ops')),
  }),
);
