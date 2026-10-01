import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler, v10ControlLoop } from './index';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

app.post('/api/control-loop', async (req, res) => {
  const expected = process.env.CONTROL_LOOP_TOKEN;
  const supplied = req.header('x-v10-control-token') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(503).json({ error: 'CONTROL_LOOP_TOKEN is not configured' });
  if (supplied !== expected) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await v10ControlLoop();
    return res.status(result?.statusCode || 200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Control loop failed' });
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
