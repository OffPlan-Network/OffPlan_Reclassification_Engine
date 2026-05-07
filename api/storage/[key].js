import {
  StorageError,
  getOne,
  setOne,
  deleteOne,
  parseBody,
} from '../_lib/storage-handler.js';

// Per-key operations:
//   GET    /api/storage/<key>       → returns { value } or { value: null }
//   PUT    /api/storage/<key>       → upserts; body is the raw value (any JSON)
//   DELETE /api/storage/<key>       → removes the row
//
// Vercel encodes the dynamic segment as req.query.key. Keys may contain
// colons (e.g. "employer:DEMO_ABC"); the client must percent-encode them.
export default async function handler(req, res) {
  try {
    const raw = req.query.key;
    const key = Array.isArray(raw) ? raw.join('/') : raw;
    if (!key) throw new StorageError(400, 'key is required');

    if (req.method === 'GET') {
      const value = await getOne(key);
      return res.status(200).json({ value });
    }

    if (req.method === 'PUT') {
      const body = parseBody(req);
      // Accept either { value: ... } or the raw value as the body.
      const value = body && Object.prototype.hasOwnProperty.call(body, 'value')
        ? body.value
        : body;
      const out = await setOne(key, value);
      return res.status(200).json(out);
    }

    if (req.method === 'DELETE') {
      const out = await deleteOne(key);
      return res.status(200).json(out);
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    if (err instanceof StorageError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[/api/storage/[key]] unexpected error', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
