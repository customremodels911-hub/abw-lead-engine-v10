import { createHash } from 'node:crypto';
import { Pool } from 'pg';

type V10Record = {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not configured: memory storage is not durable');
  return new Pool({
    connectionString,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000
  });
}

export async function inspectV10Database() {
  const configured = Boolean(process.env.DATABASE_URL);
  if (!configured) return { configured: false, persistent: false, reachable: false,
    warning: 'V10 has no DATABASE_URL and may be using volatile in-memory storage' };
  const pool = makePool();
  try {
    const db = await pool.query(
      "SELECT to_regclass('public.v10_records') IS NOT NULL AS has_table, current_database() AS database_name"
    );
    const hasTable = Boolean(db.rows[0]?.has_table);
    const counts = hasTable
      ? await pool.query('SELECT collection, count(*)::int AS count FROM public.v10_records GROUP BY collection ORDER BY collection')
      : { rows: [] as Array<{ collection: string; count: number }> };
    return {
      configured: true,
      persistent: true,
      reachable: true,
      hasTable,
      counts: counts.rows,
      totalRecords: counts.rows.reduce((sum, row) => sum + Number(row.count), 0),
      lastVerifiedAt: new Date().toISOString(),
      expiresOnCurrentRenderFreePlan: '2026-10-31',
      warning: 'A reachable database is not a backup. Export and verify before plan expiry.'
    };
  } finally {
    await pool.end();
  }
}

export async function exportV10LogicalBackup() {
  const pool = makePool();
  try {
    const exists = await pool.query("SELECT to_regclass('public.v10_records') IS NOT NULL AS has_table");
    if (!exists.rows[0]?.has_table) throw new Error('v10_records table not found; no PostgreSQL records to export');
    const rows = await pool.query<V10Record>(
      'SELECT id, collection, data, created_at, updated_at FROM public.v10_records ORDER BY collection, created_at, id LIMIT 10001'
    );
    if (rows.rowCount === 10001) throw new Error('More than 10,000 records; export requires an extended paginated procedure');
    const body = {
      format: 'v10-logical-snapshot-v1',
      source: 'Render PostgreSQL / public.v10_records',
      createdAt: new Date().toISOString(),
      records: rows.rows,
      recordCount: rows.rowCount || 0,
      restorePolicy: 'Preserve ids and timestamps; validate row count and checksums before cutover; avoid duplicate inserts.'
    };
    const canonical = JSON.stringify(body);
    const sha256 = createHash('sha256').update(canonical).digest('hex');
    const payload = JSON.stringify({ ...body, sha256OfBody: sha256 });
    if (Buffer.byteLength(payload, 'utf8') > 24 * 1024 * 1024) throw new Error('Backup too large for HTTP export; use streamed dump');
    return { payload, recordCount: body.recordCount, sha256 };
  } finally {
    await pool.end();
  }
}
