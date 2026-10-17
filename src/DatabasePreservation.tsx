import { useEffect, useState } from 'react';
import { api } from './api';

type DatabaseState = {
  configured?: boolean;
  persistent?: boolean;
  reachable?: boolean;
  totalRecords?: number;
  counts?: Array<{collection: string; count: number}>;
  lastVerifiedAt?: string;
  warning?: string;
};

export default function DatabasePreservation() {
  const [state, setState] = useState<DatabaseState | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function verify() {
    try {
      const result = await api.get<DatabaseState>('/api/database/status');
      setState(result.data);
      if (!result.data.reachable || !result.data.persistent) setNote('DATABASE AT RISK: V10 has not verified durable records. Do not rely on this app as your only copy.');
    } catch (err) {
      setState({ reachable: false, persistent: false });
      setNote('Could not verify database. Check access key and Render configuration.');
    }
  }
  useEffect(() => { void verify(); }, []);

  async function saveBackup() {
    setBusy(true);
    setNote('Preparing protected PostgreSQL logical export...');
    try {
      const accessKey = sessionStorage.getItem('v10_access_key');
      if (!accessKey) throw new Error('Sign in with your existing V10 access key and refresh.');
      const response = await fetch('/api/database/export', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'x-v10-access-key': accessKey }
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.reason || error?.error || 'Export failed');
      }
      const body = await response.blob();
      if (!body.size) throw new Error('Server returned an empty file.');
      const name = 'v10-postgres-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      const url = URL.createObjectURL(body);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const count = response.headers.get('x-v10-backup-records') || 'unknown';
      const hash = response.headers.get('x-v10-backup-sha256') || 'not provided';
      setNote('Download started: ' + name + ' | records: ' + count + ' | SHA-256: ' + hash +
        '. Save a second private copy and confirm it opens before any database cutover. The existing Render database has NOT been deleted.');
    } catch (error) {
      setNote('Backup NOT completed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setBusy(false);
    }
  }

  return <section className='panel' style={{ marginBottom: 18 }}>
    <div className='panelHead'><h2>Database Protection — October 31 Deadline</h2>
      <button className='secondary' type='button' onClick={() => void verify()}>Verify Storage</button></div>
    <p><strong>Storage: </strong>
      {!state ? 'Checking...' : state.reachable && state.persistent
        ? 'PostgreSQL reachable — ' + String(state.totalRecords ?? '?') + ' records'
        : 'NOT VERIFIED — data may be temporary'}</p>
    <p>Render free PostgreSQL expires October 31, 2026. Export your data now, verify the file, then migrate to permanent storage. Keep the original until migration is verified.</p>
    <button type='button' onClick={() => void saveBackup()} disabled={busy || !state?.reachable || !state?.persistent}>
      {busy ? 'Exporting...' : 'Download Private Database Backup'}
    </button>
    {state?.counts && <small>Collections: {state.counts.map(x => x.collection + ': ' + x.count).join(' | ') || 'none'}</small>}
    {note && <p role='status' style={{ overflowWrap: 'anywhere' }}>{note}</p>}
  </section>;
}
