interface Env {
  DB: D1Database;
  SYNC_TOKEN?: string;
  ASSETS: Fetcher;
}

const COLLECTION = 'poultryData';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function authorized(request: Request, env: Env) {
  const token = env.SYNC_TOKEN?.trim();
  if (!token) return true;
  return request.headers.get('authorization') === `Bearer ${token}`;
}

async function ensureSchema(env: Env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_storage (
    collection_name TEXT NOT NULL,
    document_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection_name, document_id)
  )`).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/storage')) {
      return env.ASSETS.fetch(request);
    }

    try {
      await ensureSchema(env);
      const parts = url.pathname.split('/').filter(Boolean);
      const collection = parts[2];
      const id = parts[3];

      if (collection !== COLLECTION) return json({ error: 'Collection not found' }, 404);

      if (request.method === 'GET' && !id) {
        const result = await env.DB.prepare(
          'SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name = ? ORDER BY updated_at ASC',
        ).bind(collection).all();
        return json({
          documents: (result.results || []).map((row: any) => ({
            id: row.id,
            data: JSON.parse(String(row.data)),
            updatedAt: row.updated_at,
          })),
        });
      }

      if (request.method === 'GET' && id) {
        const row: any = await env.DB.prepare(
          'SELECT document_id AS id, data, updated_at FROM app_storage WHERE collection_name = ? AND document_id = ? LIMIT 1',
        ).bind(collection, id).first();
        if (!row) return json({ exists: false, data: null, id });
        return json({ exists: true, id: row.id, data: JSON.parse(String(row.data)), updatedAt: row.updated_at });
      }

      if (request.method === 'PUT' && id) {
        if (!authorized(request, env)) return json({ error: 'Unauthorized' }, 401);
        const body = await request.json();
        const updatedAt = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO app_storage (collection_name, document_id, data, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(collection_name, document_id)
           DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        ).bind(collection, id, JSON.stringify(body), updatedAt).run();
        return json({ ok: true, id, data: body, updatedAt });
      }

      return json({ error: 'Method not allowed' }, 405);
    } catch (error: any) {
      return json({ error: error?.message || 'Cloud storage error' }, 500);
    }
  },
};
