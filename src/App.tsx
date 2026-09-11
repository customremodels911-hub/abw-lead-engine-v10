import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';

type Lead = { id: string; name: string; phone?: string; email?: string; market?: string; project?: string; source?: string; status?: string; score?: number; createdAt?: string; notes?: string; estimatedValue?: number; nextAction?: string; nextActionDue?: string; lastTouch?: string; statusUpdatedAt?: string };
const PIPELINE_STAGES = ['New Lead', 'Contacted', 'Responded', 'Qualified', 'Estimate/Bid', 'Deposit Due', 'Won/Active', 'Cash Collected', 'Hold', 'Lost'];

function App() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [status, setStatus] = useState('Checking...');
    const [googleStatus, setGoogleStatus] = useState('Checking...');
    const [message, setMessage] = useState('');
    const [form, setForm] = useState({ name: '', phone: '', email: '', market: 'Virginia', project: 'General Remodeling', value: '', notes: '' });

    const refresh = async () => {
        const [leadRes, statusRes, googleRes] = await Promise.all([api.get('/api/leads'), api.get('/api/integrations/thumbtack/status'), api.get('/api/integrations/google-ads/status')]);
        setLeads(leadRes.data.leads || []);
        setStatus(statusRes.data.configured ? 'READY' : 'NEEDS SECRET');
        setGoogleStatus(googleRes.data.configured ? 'READY' : 'NEEDS SECRET');
    };

    useEffect(() => { refresh().catch(() => setMessage('Could not load the lead engine.')); }, []);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setMessage('');
        if (!form.name.trim()) { setMessage('Lead name is required.'); return; }
        await api.post('/api/leads', { ...form, value: Number(form.value || 0), source: 'Manual' });
        setForm({ ...form, name: '', phone: '', email: '', value: '', notes: '' });
        setMessage('Lead added.');
        await refresh();
    };

    const updateOperatorField = async (leadId: string, patch: { estimatedValue?: number; nextAction?: string; nextActionDue?: string }) => {
        try {
            await api.put(`/api/leads/${leadId}/operator`, patch);
            await refresh();
        } catch {
            setMessage('Could not save the opportunity plan.');
        }
    };

    const isSynthetic = (lead: Lead) => /test|demo|synthetic/i.test(lead.source || '') || /test|demo|synthetic/i.test(lead.notes || '');
    const isClosed = (lead: Lead) => ['Cash Collected', 'Lost'].includes(lead.status || '');
    const isOverdue = (lead: Lead) => Boolean(lead.nextActionDue && !isClosed(lead) && lead.nextActionDue < new Date().toISOString().slice(0, 10));
    const money = (value?: number) => '$' + Math.round(value || 0).toLocaleString();
    const stageProbability = (stage?: string) => ({ 'New Lead': 0.1, Contacted: 0.2, Responded: 0.35, Qualified: 0.5, 'Estimate/Bid': 0.65, 'Deposit Due': 0.85, 'Won/Active': 0.95, 'Cash Collected': 1, Hold: 0.1, Lost: 0 }[stage || 'New Lead'] || 0);

    const realLeads = useMemo(() => leads.filter(lead => !isSynthetic(lead)), [leads]);
    const syntheticLeads = useMemo(() => leads.filter(isSynthetic), [leads]);
    const wonLeads = useMemo(() => realLeads.filter(lead => ['Won/Active', 'Cash Collected'].includes(lead.status || '')), [realLeads]);
    const cashLeads = useMemo(() => realLeads.filter(lead => lead.status === 'Cash Collected'), [realLeads]);
    const contactedLeads = useMemo(() => realLeads.filter(lead => !['New Lead'].includes(lead.status || 'New Lead')), [realLeads]);
    const sourcePerformance = useMemo(() => {
        const groups = new Map<string, { source: string; leads: number; won: number; cash: number; pipeline: number }>();
        realLeads.forEach(lead => {
            const source = lead.source || 'Unknown';
            const current = groups.get(source) || { source, leads: 0, won: 0, cash: 0, pipeline: 0 };
            current.leads += 1;
            if (['Won/Active', 'Cash Collected'].includes(lead.status || '')) current.won += 1;
            if (lead.status === 'Cash Collected') current.cash += lead.estimatedValue || 0;
            if (!['Lost', 'Cash Collected'].includes(lead.status || '')) current.pipeline += lead.estimatedValue || 0;
            groups.set(source, current);
        });
        return Array.from(groups.values()).sort((a, b) => (b.cash + b.pipeline) - (a.cash + a.pipeline));
    }, [realLeads]);

    const activeReal = realLeads.filter(lead => !isClosed(lead));
    const priorityLeads = activeReal.slice(0, 5);
    const realCash = cashLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const realPipeline = activeReal.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const weightedPipeline = realLeads.filter(lead => lead.status !== 'Lost').reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    const contactRate = realLeads.length ? Math.round((contactedLeads.length / realLeads.length) * 100) : 0;
    const winRate = realLeads.length ? Math.round((wonLeads.length / realLeads.length) * 100) : 0;
    const proofReady = realLeads.length > 0 && wonLeads.length > 0;

    const updateLeadStatus = async (leadId: string, nextStatus: string) => {
        setMessage('Updating pipeline stage...');
        try {
            await api.put(`/api/leads/${leadId}/status`, { status: nextStatus });
            setMessage(`Pipeline stage updated to ${nextStatus}.`);
            await refresh();
        } catch {
            setMessage('Could not update the pipeline stage.');
        }
    };

    const testThumbtack = async () => {
        setMessage('');
        await api.post('/api/test-thumbtack', {});
        setMessage('Thumbtack test lead received.');
        await refresh();
    };

    const testGoogleAds = async () => {
        setMessage('');
        await api.post('/api/test-google-ads', {});
        setMessage('Google Ads test lead received.');
        await refresh();
    };

    const scanPublic = async () => {
        setMessage('Scanning public homeowner opportunities...');
        try {
            const response = await api.post('/api/public-opportunities/scan', {});
            setMessage(`Public scan complete: ${response.data.added || 0} new opportunities added.`);
            await refresh();
        } catch {
            setMessage('Public opportunity source is temporarily unavailable.');
        }
    };

    return (
        <main className='shell'>
            <header className='top'><div><p className='eyebrow'>ABW ENTERPRISE</p><h1>Lead Engine V10</h1><p className='sub'>NC Custom Remodels LLC · Virginia · Charlotte / Lake Norman · NYC</p></div><div><div className={'badge ' + (status === 'READY' ? 'good' : 'warn')}>Thumbtack: {status}</div><div className={'badge ' + (googleStatus === 'READY' ? 'good' : 'warn')}>Google Ads: {googleStatus}</div><div className={'badge ' + (proofReady ? 'good' : 'warn')}>Buyer Proof: {proofReady ? 'REAL CONVERSION VERIFIED' : 'BUILDING PROOF'}</div></div></header>
            <section className='stats'><div><span>Open real opportunities</span><strong>{activeReal.length}</strong></div><div><span>Active pipeline $</span><strong>{money(realPipeline)}</strong></div><div><span>Weighted pipeline $</span><strong>{money(weightedPipeline)}</strong></div><div><span>Cash collected $</span><strong>{money(realCash)}</strong></div><div><span>Contact rate</span><strong>{contactRate}%</strong></div><div><span>Win rate</span><strong>{winRate}%</strong></div><div><span>Real leads</span><strong>{realLeads.length}</strong></div><div><span>Demo/test excluded</span><strong>{syntheticLeads.length}</strong></div></section>
            {message && <div className='notice'>{message}</div>}
            <section className='panel priorityPanel'><div className='panelHead'><h2>Revenue Proof</h2><small>Real production data only — test/demo leads excluded</small></div><div className='priorityList'><div className='priorityItem'><strong>{wonLeads.length} verified wins</strong><span>{cashLeads.length} cash-collected records · {money(realCash)} attributed revenue</span><small>{proofReady ? 'Buyer proof chain has at least one real converted opportunity.' : 'Next milestone: move one real opportunity through Won/Active and Cash Collected.'}</small></div></div></section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Source Performance</h2><small>Shows buyers where pipeline and revenue originate</small></div>{sourcePerformance.length === 0 ? <p className='empty'>No real source data yet.</p> : <div className='tableWrap'><table><thead><tr><th>Source</th><th>Real Leads</th><th>Wins</th><th>Open Pipeline</th><th>Cash</th></tr></thead><tbody>{sourcePerformance.map(row => <tr key={row.source}><td><b>{row.source}</b></td><td>{row.leads}</td><td>{row.won}</td><td>{money(row.pipeline)}</td><td>{money(row.cash)}</td></tr>)}</tbody></table></div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Today's Priority Queue</h2><small>Closest to cash first</small></div>{priorityLeads.length === 0 ? <p className='empty'>No active real opportunities yet.</p> : <div className='priorityList'>{priorityLeads.map((lead, index) => <div className={'priorityItem ' + (isOverdue(lead) ? 'priorityOverdue' : '')} key={lead.id}><strong>#{index + 1} {lead.name}</strong><span>{lead.status || 'New Lead'} · {money(lead.estimatedValue)}</span><span>{lead.nextAction || 'Contact and qualify opportunity'}</span><small>{nextActionLabel(lead, isOverdue(lead))}</small></div>)}</div>}</section>
            <section className='grid'>
                <form className='panel' onSubmit={submit}><h2>Add Lead</h2><label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>Email<input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Market<select value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}><option>Virginia</option><option>Charlotte / Lake Norman</option><option>NYC</option><option>Other</option></select></label><label>Project<select value={form.project} onChange={e => setForm({ ...form, project: e.target.value })}><option>General Remodeling</option><option>Electrical</option><option>Bathroom</option><option>Kitchen</option><option>Addition</option><option>Fence</option><option>Roofing</option><option>Other</option></select></label><label>Estimated Value<input type='number' min='0' value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder='0' /></label><label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><button type='submit'>Add to Pipeline</button><button className='secondary' type='button' onClick={scanPublic}>Scan Public Opportunities Now</button><button className='secondary' type='button' onClick={testThumbtack}>Run Thumbtack Test</button><button className='secondary' type='button' onClick={testGoogleAds}>Run Google Ads Test</button></form>
                <section className='panel wide'><div className='panelHead'><h2>Lead Inbox</h2><button className='secondary' onClick={() => refresh()}>Refresh</button></div>{leads.length === 0 ? <p className='empty'>No leads yet.</p> : <div className='tableWrap'><table><thead><tr><th>Lead</th><th>Market</th><th>Project</th><th>Source</th><th>Proof</th><th>Score</th><th>Value</th><th>Status</th><th>Next Action</th><th>Due</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id} className={isOverdue(lead) ? 'overdueRow' : ''}><td><b>{lead.name}</b><small>{lead.phone || lead.email || ''}</small></td><td>{lead.market}</td><td>{lead.project}</td><td>{lead.source}</td><td>{isSynthetic(lead) ? 'DEMO/TEST' : 'REAL'}</td><td>{lead.score ?? 0}</td><td><input className='miniInput valueInput' type='number' min='0' defaultValue={lead.estimatedValue || ''} placeholder='0' onBlur={e => updateOperatorField(lead.id, { estimatedValue: Number(e.target.value || 0) })} /></td><td><select className='stageSelect' value={lead.status || 'New Lead'} onChange={e => updateLeadStatus(lead.id, e.target.value)}>{PIPELINE_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></td><td><input className='miniInput actionInput' defaultValue={lead.nextAction || ''} placeholder='Next action' onBlur={e => updateOperatorField(lead.id, { nextAction: e.target.value })} /></td><td><input className='miniInput dueInput' type='date' defaultValue={lead.nextActionDue || ''} onChange={e => updateOperatorField(lead.id, { nextActionDue: e.target.value })} />{isOverdue(lead) && <small className='overdueText'>OVERDUE</small>}</td></tr>)}</tbody></table></div>}</section>
            </section>
        </main>
    );
}

function nextActionLabel(lead: Lead, overdue: boolean) {
    return `${lead.nextActionDue ? `Due ${lead.nextActionDue}` : 'Set a due date'}${overdue ? ' · OVERDUE' : ''}`;
}

export default App;