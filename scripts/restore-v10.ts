/**
 * One-time V10 logical restore to a NEW PostgreSQL database.
 * By default this script only checks the exported JSON file.
 * Requires TARGET_DATABASE_URL and V10_RESTORE_APPROVED=YES for --execute.
 *
 * Usage: npx tsx scripts/restore-v10.ts path/to/private-v10-backup.json
 *   TARGET_DATABASE_URL='...' V10_RESTORE_APPROVED=YES npx tsx scripts/restore-v10.ts path/to/private-v10-backup.json --execute
 *
 * NEVER store customer exports or database credentials in the public repository.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

type SnapshotRecord = {
  id: string; collection: string; data: Record<string, unknown>;
  created_at: string; updated_at: string;
};
type Snapshot = {
  format: string; source: string; createdAt: string;
  records: SnapshotRecord[]; recordCount: number; restorePolicy: string;
  sha256OfBody: string;
};

const file = process.argv[2];
if (!file) throw new Error('Pass the private snapshot file path');
const restore = process.argv.includes('--execute');
const snapshot = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
const { sha256OfBody, ...unsigned } = snapshot;
const hash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
if (snapshot.format !== 'v10-logical-snapshot-v1' || hash !== sha256OfBody) {
  throw new Error('Backup format or SHA-256 integrity check failed. No changes made.');
}
if (snapshot.records.length !== snapshot.recordCount) throw new Error('Backup count mismatch');
for (const record of snapshot.records) {
  if (!record.id || !record.collection || !record.data || typeof record.data !== 'object') {
    throw new Error('Invalid row in backup');
  }
}
const groups = Object.entries(snapshot.records.reduce((acc, r) => {
  acc[r.collection] = (acc[r.collection] || 0) + 1; return acc;
}, {} as Record<string, number>));
console.log(JSON.stringify({ verified: true, recordCount: snapshot.recordCount, collections: groups, sha256: hash }));
if (!restore) {
  console.log('DRY RUN ONLY. No database was changed. Use --execute with TARGET_DATABASE_URL and V10_RESTORE_APPROVED=YES after verifying source backup and target.');
  process.exit(0);
}
if (process.env.V10_RESTORE_APPROVED !== 'YES') throw new Error('Explicit restore approval flag missing');
const target = process.env.TARGET_DATABASE_URL;
if (!target) throw new Error('TARGET_DATABASE_URL is required');
if (process.env.DATABASE_URL && process.env.DATABASE_URL === target) {
  throw new Error('Target matches DATABASE_URL, which may be the expiring source. Refusing.');
}
const pool = new Pool({
  connectionString: target,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 1, connectionTimeoutMillis: 10000
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS public.v10_records (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const existing = await client.query('SELECT COUNT(*)::int AS count FROM public.v10_records');
  if (Number(existing.rows[0].count) !== 0) throw new Error('Target is not empty; refusing to overwrite customer records');
  for (const r of snapshot.records) {
    await client.query(
      'INSERT INTO public.v10_records(id, collection, data, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)',
      [r.id, r.collection, JSON.stringify(r.data), r.created_at, r.updated_at]
    );
  }
  await client.query('CREATE INDEX IF NOT EXISTS v10_records_collection_created_idx ON public.v10_records(collection, created_at DESC)');
  const result = await client.query('SELECT COUNT(*)::int AS count FROM public.v10_records');
  if (Number(result.rows[0].count) !== snapshot.recordCount) throw new Error('Restore count mismatch. Rolled back.');
  await client.query('COMMIT');
  console.log('RESTORE COMPLETE and counts verified. Keep original database until application cutover and end-to-end tests pass.');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
