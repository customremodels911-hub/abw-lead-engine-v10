import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler, v10ControlLoop } from './index';
import { db } from './runtime';
import { inspectV10Database, exportV10LogicalBackup } from './database-preservation';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// Keep customer identities, phone numbers, and revenue records private.
// This must be configured in the Render environment, never committed to GitHub.
app.use('/api', (req, res, next) => {
  if (req.path === '/control-loop') return next(); // Separate server-to-server token.
  const expected = process.env.V10_ACCESS_KEY;
  if (!expected) return res.status(503).json({ error: 'Private dashboard access has not been configured' });
  const provided = req.header('x-v10-access-key') || '';
  if (provided !== expected) return res.status(401).json({ error: 'Invalid dashboard access key' });
  next();
});
const controlState = async () => {
  if (!process.env.DATABASE_URL) return { datastore: 'not-configured', lastRun: null };
  try {
    const { items } = await db.list<{ finishedAt: string; status: string; durationMs: number }>('control_loop_health', { limit: 1 });
    return { datastore: 'connected', lastRun: items[0] || null };
  } catch {
    return { datastore: 'unavailable', lastRun: null };
  }
};
let loopInProgress = false;
app.get('/healthz', async (_req, res) => {
  const state = await controlState();
  const recent = state.lastRun?.finishedAt && Date.now() - Date.parse(state.lastRun.finishedAt) < 120 * 60 * 1000;
  res.json({ service: 'ABW Lead Engine V10', web: 'online', datastore: state.datastore,
    automation: !state.lastRun ? 'unverified' : recent ? 'recent-run' : 'stale',
    lastRunAt: state.lastRun?.finishedAt || null,
    warning: 'Web service availability does not prove automatic lead scanning or external integration delivery' });
});
app.get('/api/ops-health', async (_req, res) => {
  const state = await controlState();
  res.json({ ...state, controlLoopTokenConfigured: Boolean(process.env.CONTROL_LOOP_TOKEN),
    v10AccessKeyConfigured: Boolean(process.env.V10_ACCESS_KEY),
    web: 'online', staleAfterMinutes: 120,
    caution: 'Controller completion does not prove each external source succeeded; inspect logs and lead changes' });
});

app.get('/api/database/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.json(await inspectV10Database());
  } catch (err) {
    console.error('Database status verification failed', err instanceof Error ? err.message : 'unknown');
    return res.status(503).json({ configured: Boolean(process.env.DATABASE_URL), persistent: false,
      reachable: false, warning: 'Cannot verify persistent V10 data; do not assume data is saved.' });
  }
});

app.get('/api/database/export', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const backup = await exportV10LogicalBackup();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="v10-postgres-backup-${date}.json"`);
    res.setHeader('X-V10-Backup-Records', String(backup.recordCount));
    res.setHeader('X-V10-Backup-SHA256', backup.sha256);
    return res.status(200).send(backup.payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Backup failed';
    console.error('V10 authenticated backup export failed', reason);
    return res.status(503).json({ error: 'Database export unavailable', reason, exported: false });
  }
});

app.post('/api/control-loop', async (req, res) => {
  const expected = process.env.CONTROL_LOOP_TOKEN;
  const supplied = req.header('x-v10-control-token') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(503).json({ error: 'CONTROL_LOOP_TOKEN is not configured' });
  if (supplied !== expected) return res.status(401).json({ error: 'Unauthorized' });
  if (loopInProgress) return res.status(409).json({ error: 'Control loop already running' });
  loopInProgress = true;
  const started = Date.now();
  try {
    const result = await v10ControlLoop();
    const health = { finishedAt: new Date().toISOString(), durationMs: Date.now() - started,
      status: 'controller-returned; inspect per-source logs', httpStatus: result?.statusCode || 200 };
    try {
      const { items } = await db.list('control_loop_health', { limit: 1 });
      if (items.length) await db.update('control_loop_health', [{ id: items[0].id, record: health }]);
      else await db.add('control_loop_health', [health]);
    } catch (auditError) { console.error('Unable to persist control loop status', auditError); }
    return res.status(result?.statusCode || 200).json({ ok: true, runRecorded: health.finishedAt,
      warning: 'Check per-stage logs; this controller may continue after individual stages fail' });
  } catch (err) {
    console.error('V10 control loop failed', err);
    return res.status(500).json({ error: 'Control loop failed; see protected application logs' });
  } finally {
    loopInProgress = false;
  }
});

app.use(handler as any);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) return next();
  res.sendFile(path.join(dist, 'index.html'));
});

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`ABW Lead Engine V10 listening on ${port}`));
