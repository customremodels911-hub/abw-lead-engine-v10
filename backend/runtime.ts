import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

type DbRecord = Record<string, any>;
type RouteContext = { body: any; params: Record<string,string>; query: Record<string,any>; event: { headers: Record<string,any>; body: string } };
type RouteResult = { __v10Result: true; statusCode: number; data: any };

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  pool = new Pool({ connectionString, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }, max: 5 });
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    const database = getPool();
    await database.query(`CREATE TABLE IF NOT EXISTS v10_records (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await database.query('CREATE INDEX IF NOT EXISTS v10_records_collection_created_idx ON v10_records(collection, created_at DESC)');
  })();
  return schemaReady;
}

export const db = {
  async list<T extends DbRecord>(collection: string, options: { limit?: number } = {}) {
    await ensureSchema();
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    const result = await getPool().query('SELECT id, data FROM v10_records WHERE collection = $1 ORDER BY created_at DESC LIMIT $2', [collection, limit]);
    return { items: result.rows.map(row => ({ id: row.id, ...(row.data || {}) })) as Array<T & { id: string }> };
  },
  async get<T extends DbRecord>(collection: string, ids: string[]) {
    await ensureSchema();
    if (!ids.length) return [] as Array<T & { id: string }>;
    const result = await getPool().query('SELECT id, data FROM v10_records WHERE collection = $1 AND id = ANY($2::text[])', [collection, ids]);
    const byId = new Map(result.rows.map(row => [row.id, { id: row.id, ...(row.data || {}) }]));
    return ids.map(id => byId.get(id)).filter(Boolean) as Array<T & { id: string }>;
  },
  async add(collection: string, records: DbRecord[]) {
    await ensureSchema();
    const ids: string[] = [];
    for (const record of records) {
      const id = randomUUID();
      await getPool().query('INSERT INTO v10_records(id, collection, data) VALUES ($1, $2, $3::jsonb)', [id, collection, JSON.stringify(record)]);
      ids.push(id);
    }
    return ids;
  },
  async update(collection: string, updates: Array<{ id: string; record: DbRecord }>) {
    await ensureSchema();
    const ids: string[] = [];
    for (const item of updates) {
      const result = await getPool().query('UPDATE v10_records SET data = $1::jsonb, updated_at = NOW() WHERE collection = $2 AND id = $3 RETURNING id', [JSON.stringify(item.record), collection, item.id]);
      if (result.rowCount) ids.push(item.id);
    }
    return ids;
  },
  async delete(collection: string, ids: string[]) {
    await ensureSchema();
    if (!ids.length) return [];
    await getPool().query('DELETE FROM v10_records WHERE collection = $1 AND id = ANY($2::text[])', [collection, ids]);
    return ids;
  }
};

export const secrets = {
  async listSecretNames() { return Object.entries(process.env).filter(([, value]) => Boolean(value)).map(([key]) => key); },
  async readSecret(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not configured`);
    return value;
  }
};

export const ai = {
  async generate(args: { system?: string; prompt?: string; schema?: unknown; maxTokens?: number; temperature?: number }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { text: args.schema ? '{}' : 'AI generation disabled because GEMINI_API_KEY is not configured.' };
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = [args.system || '', args.prompt || ''].filter(Boolean).join('\n\n');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: args.temperature ?? 0.2, maxOutputTokens: args.maxTokens || 1200 }
      })
    });
    if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
    const payload: any = await response.json();
    const text = (payload.candidates?.[0]?.content?.parts || []).map((part: any) => part.text || '').join('');
    return { text };
  }
};

export function json(data: any, statusCode = 200): RouteResult { return { __v10Result: true, statusCode, data }; }
export function error(message: string, statusCode = 400): RouteResult { return json({ error: message }, statusCode); }

function compilePath(path: string) {
  const names: string[] = [];
  const escaped = path.split('/').map(part => {
    if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${escaped}/?$`), names };
}

export function router(routes: Record<string, Array<(context: RouteContext) => any>>) {
  const compiled = Object.entries(routes).map(([key, handlers]) => {
    const firstSpace = key.indexOf(' ');
    const method = key.slice(0, firstSpace).toUpperCase();
    const path = key.slice(firstSpace + 1);
    return { method, handlers, ...compilePath(path) };
  });
  return async (req: any, res: any, next: any) => {
    const pathname = req.path || String(req.url || '').split('?')[0];
    const route = compiled.find(item => item.method === String(req.method || '').toUpperCase() && item.regex.test(pathname));
    if (!route) return next();
    const match = pathname.match(route.regex)!;
    const params: Record<string,string> = {};
    route.names.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]); });
    const context: RouteContext = { body: req.body, params, query: req.query || {}, event: { headers: req.headers || {}, body: req.rawBody || '' } };
    try {
      let result: any;
      for (const routeHandler of route.handlers) {
        result = await routeHandler(context);
        if (result !== undefined) break;
      }
      if (result?.__v10Result) return res.status(result.statusCode).json(result.data);
      if (result && typeof result.statusCode === 'number') return res.status(result.statusCode).json(result.body ?? {});
      if (result === undefined) return res.status(204).end();
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  };
}
