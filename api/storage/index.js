import {
  StorageError,
  listKeys,
  setOne,
  clearAll,
  parseBody,
} from '../_lib/storage-handler.js';

// Collection-level operations:
//   GET    /api/storage?prefix=employer:   → list keys
//   POST   /api/storage  { key, value }    → upsert
//   DELETE /api/storage                    → clear all (only allowed when ?confirm=yes)
//
// Per-key operations live in /api/storage/[key].js.
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
      const keys = await listKeys(prefix);
      return res.status(200).json({ keys });
    }

    if (req.method === 'POST') {
      const { key, value } = parseBody(req);
      const out = await setOne(key, value);
      return res.status(200).json(out);
    }

    if (req.method === 'DELETE') {
      if (req.query.confirm !== 'yes') {
        throw new StorageError(400, 'clearAll requires ?confirm=yes');
      }
      const out = await clearAll();
      return res.status(200).json(out);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    if (err instanceof StorageError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[/api/storage] unexpected error', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
