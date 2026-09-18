import { FormEvent, useEffect, useState } from 'react';
import { api } from '@appdeploy/client';

type Lead = { id: string; name: string; phone?: string; email?: string; market?: string; project?: string; source?: string; status?: string; score?: number; createdAt?: string; notes?: string; estimatedValue?: number; nextAction?: string; nextActionDue?: string; lastTouch?: string; statusUpdatedAt?: string; enrichmentProvider?: string; enrichmentStatus?: string; enrichmentUpdatedAt?: string; complianceReviewRequired?: boolean };
type OwnerAlert = { id: string; leadId: string; leadName: string; market: string; project: string; phone: string; email: string; sourceUrl: string; instruction: string; status: string; createdAt: string }; 
type OutreachEvent = { id: string; leadName: string; channel: string; destination: string; status: string; reason: string; createdAt: string };
type ProcurementAdvantage = { name: string; market: string; url: string; strategy: string; priority: number; score: number; action: string }; 
type SourceIntelligence = { id: string; sourceId: string; label: string; market: string; runs: number; scanned: number; added: number; failures: number; posteriorMean: number; explorationScore: number; nextScanAt: string; lastRunAt: string; lastError: string; lastAdded: number; lastScanned: number };
type StrategyGenome = { generation: number; explorationMultiplier: number; staleLeadBoost: number; valuePriorityCap: number; followUpHours: number; marketWeights: Record<string, number>; fitness: number; baselineFitness: number; status: string; lastReason: string; updatedAt: string };
type EvolutionRecord = { createdAt: string; generation: number; fitness: number; action: string; summary: string; aiHypothesis: string };
type SoftwareUpgrade = { id: string; createdAt: string; title: string; hypothesis: string; category: string; risk: string; autonomy: string; expectedImpact: number; confidence: number; priority: number; status: string; successMetric: string; rollbackTrigger: string; evidence: string };
type ReleaseRun = { id: string; upgradeId: string; title: string; updatedAt: string; stage: string; autonomy: string; baselineFitness: number; candidateScore: number; staticPassed: boolean; policyNotes: string; patchPackage: string; tests: string[]; canaryMetric: string; rollbackPlan: string };  
const PIPELINE_STAGES = ['New Lead', 'Contacted', 'Responded', 'Qualified', 'Estimate/Bid', 'Deposit Due', 'Won/Active', 'Cash Collected', 'Hold', 'Lost'];

function App() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [status, setStatus] = useState('Checking...');
    const [googleStatus, setGoogleStatus] = useState('Checking...');
    const [samStatus, setSamStatus] = useState('Checking...');
    const [batchDataStatus, setBatchDataStatus] = useState('Checking...');
    const [message, setMessage] = useState('');
    const [ownerAlerts, setOwnerAlerts] = useState<OwnerAlert[]>([]);
    const [recentOutreach, setRecentOutreach] = useState<OutreachEvent[]>([]);
    const [automaticEmailReady, setAutomaticEmailReady] = useState(false);
    const [ownerEmailAlertsReady, setOwnerEmailAlertsReady] = useState(false);
    const [sourceIntelligence, setSourceIntelligence] = useState<SourceIntelligence[]>([]);
    const [procurementAdvantages, setProcurementAdvantages] = useState<ProcurementAdvantage[]>([]);
    const [strategyGenome, setStrategyGenome] = useState<StrategyGenome | null>(null);
    const [evolutionHistory, setEvolutionHistory] = useState<EvolutionRecord[]>([]);
    const [softwareUpgrades, setSoftwareUpgrades] = useState<SoftwareUpgrade[]>([]);
    const [releaseRuns, setReleaseRuns] = useState<ReleaseRun[]>([]);
    const [form, setForm] = useState({ name: '', phone: '', email: '', market: 'Virginia', project: 'General Remodeling', value: '', notes: '' });

    const refresh = async () => {
        const [leadRes, statusRes, googleRes, samRes, batchRes, contactRes, sourceRes, evolutionRes, softwareRes] = await Promise.all([api.get('/api/leads'), api.get('/api/integrations/thumbtack/status'), api.get('/api/integrations/google-ads/status'), api.get('/api/integrations/sam/status'), api.get('/api/integrations/batchdata/status'), api.get('/api/contact-center'), api.get('/api/source-intelligence'), api.get('/api/self-improvement'), api.get('/api/software-evolution')]);
        setLeads(leadRes.data.leads || []);
        setStatus(statusRes.data.configured ? 'READY' : 'NEEDS SECRET');
        setGoogleStatus(googleRes.data.configured ? 'READY' : 'NEEDS SECRET');
        setSamStatus(samRes.data.configured ? 'READY' : 'NEEDS API KEY');
        setBatchDataStatus(batchRes.data.configured ? 'READY' : 'NEEDS TOKEN');
        setOwnerAlerts(contactRes.data.alerts || []);
        setRecentOutreach(contactRes.data.recentOutreach || []);
        setAutomaticEmailReady(Boolean(contactRes.data.automaticEmailReady));
        setOwnerEmailAlertsReady(Boolean(contactRes.data.ownerEmailAlertsReady));
        setSourceIntelligence(sourceRes.data.sources || []);
        setProcurementAdvantages(sourceRes.data.procurementAdvantages || []);
        setStrategyGenome(evolutionRes.data.genome || null);
        setEvolutionHistory(evolutionRes.data.history || []);
        setSoftwareUpgrades(softwareRes.data.upgrades || []);
        setReleaseRuns(softwareRes.data.releaseRuns || []);
    };

    useEffect(() => { refresh().catch(() => setMessage('Could not load the lead engine.')); }, []);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setMessage('');
        if (!form.name.trim()) { setMessage('Lead name is required.'); return; }
        await api.post('/api/leads', { ...form, source: 'Manual' });
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

    const isSynthetic = (lead: Lead) => (lead.source || '').includes('Test');
    const isMarketSignal = (lead: Lead) => /permit signal|dob job filing/i.test(lead.source || '');
    const isContactable = (lead: Lead) => Boolean(lead.phone || lead.email || /https?:\/\//i.test(lead.notes || ''));
    const isVerifiedLead = (lead: Lead) => !isSynthetic(lead) && (!isMarketSignal(lead) || isContactable(lead));
    const isClosed = (lead: Lead) => ['Cash Collected', 'Lost'].includes(lead.status || '');
    const isOverdue = (lead: Lead) => Boolean(lead.nextActionDue && !isClosed(lead) && lead.nextActionDue < new Date().toISOString().slice(0, 10));
    const money = (value?: number) => '$' + Math.round(value || 0).toLocaleString();
    const stageProbability = (stage?: string) => ({ 'New Lead': 0.1, Contacted: 0.2, Responded: 0.35, Qualified: 0.5, 'Estimate/Bid': 0.65, 'Deposit Due': 0.85, 'Won/Active': 0.95, 'Cash Collected': 1, Hold: 0.1, Lost: 0 }[stage || 'New Lead'] || 0);
    const priorityLeads = leads.filter(lead => isVerifiedLead(lead) && !isClosed(lead)).slice(0, 5);
    const leadAddress = (lead: Lead) => lead.notes?.match(/Address:\s*([^|]+)/i)?.[1]?.trim() || lead.notes?.match(/Property:\s*([^|]+)/i)?.[1]?.trim() || '';
    const contactNowLeads = leads.filter(lead => !isSynthetic(lead) && !isClosed(lead) && Boolean(lead.phone || lead.email)).sort((a, b) => {
        const matchedDifference = (b.enrichmentStatus === 'matched' ? 1 : 0) - (a.enrichmentStatus === 'matched' ? 1 : 0);
        if (matchedDifference !== 0) return matchedDifference;
        return (b.score || 0) - (a.score || 0);
    }).slice(0, 20);

    const ledgerLeads = leads.filter(lead => !isSynthetic(lead));
    const ledgerWon = ledgerLeads.filter(lead => ['Won/Active', 'Cash Collected'].includes(lead.status || ''));
    const ledgerLost = ledgerLeads.filter(lead => lead.status === 'Lost');
    const ledgerCash = ledgerLeads.filter(lead => lead.status === 'Cash Collected').reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const ledgerPipeline = ledgerLeads.filter(lead => !['Cash Collected', 'Lost'].includes(lead.status || '')).reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const ledgerWeighted = ledgerLeads.filter(lead => lead.status !== 'Lost').reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    const ledgerCloseRate = ledgerWon.length + ledgerLost.length === 0 ? 0 : Math.round((ledgerWon.length / (ledgerWon.length + ledgerLost.length)) * 100);

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

    const processContact = async (leadId: string) => {
        setMessage('Processing contact route...');
        try {
            const response = await api.post(`/api/contact-center/${leadId}/run`, {});
            setMessage(`Contact routing complete: ${response.data.action}.`);
            await refresh();
        } catch {
            setMessage('Could not process this contact route.');
        }
    };

    const resolveAlert = async (alertId: string) => {
        await api.post(`/api/owner-alerts/${alertId}/resolve`, {});
        setMessage('Owner action marked complete.');
        await refresh();
    };

    const scanPublic = async () => {
        setMessage('Scanning public homeowner and government opportunities...');
        try {
            const response = await api.post('/api/public-opportunities/scan', {});
            setMessage(`Public scan complete: ${response.data.added || 0} new opportunities added.`);
            await refresh();
        } catch {
            setMessage('Public opportunity source is temporarily unavailable.');
        }
    };

    const evolveNow = async () => {
        setMessage('Running bounded strategy evolution...');
        try {
            const response = await api.post('/api/self-improvement/evolve', {});
            setMessage(`Strategy ${response.data.action}: generation ${response.data.genome?.generation || '?'}.`);
            await refresh();
        } catch {
            setMessage('Strategy evolution could not complete. Existing strategy remains active.');
        }
    };

    const generateSoftwareUpgrades = async () => {
        setMessage('Running software evolution review...');
        try { const response = await api.post('/api/software-evolution/generate', {}); setMessage(`Software evolution review complete: ${response.data.generated || 0} new proposals.`); await refresh(); } catch { setMessage('Software evolution review could not complete. Existing production version remains unchanged.'); }
    };

    const decideUpgrade = async (id: string, decision: 'approved' | 'rejected') => {
        try { await api.post(`/api/software-evolution/${id}/decision`, { decision }); setMessage(`Upgrade ${decision}.`); await refresh(); } catch { setMessage('Could not update the upgrade decision.'); }
    };

    const runClosedLoop = async (id: string) => {
        setMessage('Generating candidate package and running isolated release gates...');
        try { const response = await api.post(`/api/software-evolution/${id}/run-release`, {}); setMessage(`Closed-loop release finished at stage: ${response.data.run?.stage || 'unknown'}.`); await refresh(); } catch { setMessage('Closed-loop release stopped safely; production strategy was not changed.'); }
    };

    const scanGovernment = async () => {
        setMessage('Scanning SAM.gov opportunities across NC, VA, NY and NJ...');
        try {
            const response = await api.post('/api/government-opportunities/scan', {});
            setMessage(`SAM.gov scan complete: ${response.data.added || 0} new opportunities added from ${response.data.scanned || 0} notices reviewed.`);
            await refresh();
        } catch {
            setMessage(samStatus === 'READY' ? 'SAM.gov opportunity source is temporarily unavailable.' : 'SAM.gov API key required to activate automatic federal opportunity scanning.');
        }
    };

    const runEnrichment = async () => {
        setMessage('Enriching property leads with BatchData...');
        try {
            const response = await api.post('/api/contact-now/enrich', {});
            setMessage(`BatchData enrichment complete: ${response.data.matched || 0} new contact matches; ${response.data.contactable || 0} contactable leads ready.`);
            await refresh();
        } catch {
            setMessage('BatchData enrichment could not complete. Existing contactable leads remain available.');
        }
    };

    return (
        <main className='shell'>
            <header className='top'><div><p className='eyebrow'>ABW ENTERPRISE</p><h1>Lead Engine V10</h1><p className='sub'>NC Custom Remodels LLC · Virginia · Charlotte / Lake Norman · NYC</p></div><div><div className={'badge ' + (status === 'READY' ? 'good' : 'warn')}>Thumbtack: {status}</div><div className={'badge ' + (googleStatus === 'READY' ? 'good' : 'warn')}>Google Ads: {googleStatus}</div><div className={'badge ' + (samStatus === 'READY' ? 'good' : 'warn')}>SAM.gov: {samStatus}</div><div className={'badge ' + (batchDataStatus === 'READY' ? 'good' : 'warn')}>BatchData: {batchDataStatus}</div></div></header>
            <section className='stats'><div><span>Verified opportunities</span><strong>{leads.filter(lead => isVerifiedLead(lead) && !isClosed(lead)).length}</strong></div><div><span>Verified pipeline $</span><strong>{money(leads.filter(lead => isVerifiedLead(lead) && !isClosed(lead)).reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0))}</strong></div><div><span>Weighted pipeline $</span><strong>{money(leads.filter(lead => isVerifiedLead(lead) && lead.status !== 'Lost').reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0))}</strong></div><div><span>Cash collected $</span><strong>{money(leads.filter(lead => isVerifiedLead(lead) && lead.status === 'Cash Collected').reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0))}</strong></div><div><span>Raw market signals</span><strong>{leads.filter(lead => !isSynthetic(lead) && isMarketSignal(lead) && !isContactable(lead)).length}</strong></div><div><span>Overdue verified actions</span><strong>{leads.filter(lead => isVerifiedLead(lead) && isOverdue(lead)).length}</strong></div></section>
            <section className='panel wide'>
                <div className='panelHead'><div><h2>V10 Opportunity Ledger</h2><small>Discover → qualify → contact → estimate → win/loss → cash. Every non-test opportunity remains visible so V10 can learn what actually creates revenue.</small></div><button className='secondary' onClick={() => refresh()}>Refresh Ledger</button></div>
                <section className='stats'>
                    <div><span>Opportunities discovered</span><strong>{ledgerLeads.length}</strong></div>
                    <div><span>Open pipeline $</span><strong>{money(ledgerPipeline)}</strong></div>
                    <div><span>Weighted value $</span><strong>{money(ledgerWeighted)}</strong></div>
                    <div><span>Won / active</span><strong>{ledgerWon.length}</strong></div>
                    <div><span>Lost</span><strong>{ledgerLost.length}</strong></div>
                    <div><span>Close rate</span><strong>{ledgerCloseRate}%</strong></div>
                    <div><span>Cash collected $</span><strong>{money(ledgerCash)}</strong></div>
                </section>
                {ledgerLeads.length === 0 ? <p className='empty'>The ledger will populate automatically as V10 discovers or receives opportunities.</p> : <div className='tableWrap'><table><thead><tr><th>Discovered</th><th>Opportunity</th><th>Source</th><th>Market</th><th>Project</th><th>Score</th><th>Potential $</th><th>Stage</th><th>Expected $</th><th>Next Action</th><th>Outcome</th></tr></thead><tbody>{ledgerLeads.slice().sort((a,b) => Date.parse(b.createdAt || '1970-01-01') - Date.parse(a.createdAt || '1970-01-01')).map(lead => <tr key={`ledger-${lead.id}`} className={isOverdue(lead) ? 'overdueRow' : ''}><td>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}</td><td><b>{lead.name}</b></td><td>{lead.source || 'Unknown'}</td><td>{lead.market || '—'}</td><td>{lead.project || '—'}</td><td>{lead.score ?? 0}</td><td>{money(lead.estimatedValue)}</td><td>{lead.status || 'New Lead'}</td><td>{money((lead.estimatedValue || 0) * stageProbability(lead.status))}</td><td>{lead.nextAction || 'Contact and qualify opportunity'}</td><td>{lead.status === 'Cash Collected' ? 'CASH' : lead.status === 'Lost' ? 'LOST' : ['Won/Active'].includes(lead.status || '') ? 'WON' : 'OPEN'}</td></tr>)}</tbody></table></div>}
            </section>
            {message && <div className='notice'>{message}</div>}
            <section className='panel contactPanel'><div className='panelHead'><div><h2>Contact Automation</h2><small>Automatic email: {automaticEmailReady ? 'READY' : 'FALLBACK TO OWNER'} · Owner email alerts: {ownerEmailAlertsReady ? 'READY' : 'IN-APP ONLY'}</small></div><button className='secondary' onClick={() => refresh()}>Refresh</button></div><div className='contactStats'><strong>{ownerAlerts.length}</strong><span>owner actions waiting</span><strong>{recentOutreach.filter(item => item.status === 'sent').length}</strong><span>recent automatic sends</span></div>{ownerAlerts.length === 0 ? <p className='empty'>No owner contact actions waiting.</p> : <div className='alertList'>{ownerAlerts.slice(0, 10).map(alert => <div className='alertCard' key={alert.id}><div><b>{alert.leadName}</b><small>{alert.project} · {alert.market}</small><p>{alert.instruction}</p><small>{[alert.phone, alert.email].filter(Boolean).join(' · ')}</small></div><div className='alertActions'>{alert.phone && <a href={`tel:${alert.phone}`}>Call</a>}{alert.phone && <a href={`sms:${alert.phone}`}>Text</a>}{alert.email && <a href={`mailto:${alert.email}`}>Email</a>}{alert.sourceUrl && <a href={alert.sourceUrl} target='_blank' rel='noreferrer'>Source</a>}<button onClick={() => resolveAlert(alert.id)}>Done</button></div></div>)}</div>}</section>
            <section className='panel contactPanel'><div className='panelHead'><div><h2>Contact Now</h2><small>Real contactable leads · phone/email/address in one place</small></div><button className='secondary' onClick={runEnrichment}>Enrich Now</button></div><div className='contactStats'><strong>{contactNowLeads.length}</strong><span>contactable leads ready</span><strong>{contactNowLeads.filter(lead => lead.enrichmentStatus === 'matched').length}</strong><span>BatchData matches</span></div>{contactNowLeads.length === 0 ? <p className='empty'>No contactable lead is ready yet. Use Enrich Now to retry eligible property and permit records.</p> : <div className='alertList'>{contactNowLeads.map(lead => <div className='alertCard' key={`contact-now-${lead.id}`}><div><b>{lead.name}</b><small>{lead.project || 'Project'} · {lead.market || 'Market'} · {lead.source || 'Source'}</small>{leadAddress(lead) && <p><b>Address:</b> {leadAddress(lead)}</p>}<p>{[lead.phone, lead.email].filter(Boolean).join(' · ')}</p><small>{lead.enrichmentStatus === 'matched' ? 'BatchData MATCHED' : 'Direct/source contact'}{lead.complianceReviewRequired ? ' · Verify consent/DNC/TCPA before marketing outreach.' : ''}</small></div><div className='alertActions'>{lead.phone && <a href={`tel:${lead.phone}`}>Call</a>}{lead.phone && <a href={`sms:${lead.phone}`}>Text</a>}{lead.email && <a href={`mailto:${lead.email}`}>Email</a>}<button onClick={() => processContact(lead.id)}>Process Contact</button></div></div>)}</div>}</section>
            <section className='panel sourcePanel'><div className='panelHead'><div><h2>Acquisition Intelligence</h2><small>Adaptive source learning: higher-yield feeds accelerate; weak feeds remain in exploration.</small></div><button className='secondary' onClick={() => refresh()}>Refresh</button></div>{sourceIntelligence.length === 0 ? <p className='empty'>Source learning begins after the next scan cycle.</p> : <div className='tableWrap'><table><thead><tr><th>Source</th><th>Market</th><th>Last Scan</th><th>Total Yield</th><th>Learned Rate</th><th>Health</th></tr></thead><tbody>{sourceIntelligence.slice(0, 12).map(source => <tr key={source.id}><td><b>{source.label}</b></td><td>{source.market}</td><td>{source.lastScanned} scanned / {source.lastAdded} added</td><td>{source.added} / {source.scanned}</td><td>{(source.posteriorMean * 100).toFixed(1)}%</td><td>{source.lastError ? 'ERROR' : source.failures > 2 ? 'DEGRADED' : 'ACTIVE'}</td></tr>)}</tbody></table></div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><div><h2>Procurement Advantage Engine</h2><small>Reverse-map incumbents · subcontract-first · small-business access</small></div></div>{procurementAdvantages.length === 0 ? <p className='empty'>Loading procurement advantage lanes...</p> : <div className='priorityList'>{procurementAdvantages.slice(0, 5).map(item => <div className='priorityItem' key={item.name}><strong>{item.name} · {item.score}/100</strong><span>{item.market} · {item.strategy}</span><span>{item.action}</span><small><a href={item.url} target='_blank' rel='noreferrer'>Open official source</a></small></div>)}</div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><div><h2>Self-Improvement Kernel</h2><small>Bounded evolution · automatic rollback · daily AI innovation review</small></div><button className='secondary' onClick={evolveNow}>Evolve Now</button></div>{!strategyGenome ? <p className='empty'>Strategy genome initializes automatically on the control loop.</p> : <div className='priorityList'><div className='priorityItem'><strong>Generation {strategyGenome.generation} · Fitness {strategyGenome.fitness}</strong><span>Follow-up {strategyGenome.followUpHours}h · stale boost {strategyGenome.staleLeadBoost} · value cap {strategyGenome.valuePriorityCap}</span><span>Market weights: {Object.entries(strategyGenome.marketWeights).map(([key, value]) => `${key} ${value.toFixed(2)}`).join(' · ')}</span><small>{strategyGenome.lastReason}</small></div>{evolutionHistory.slice(0, 3).map((item, index) => <div className='priorityItem' key={`${item.createdAt}-${index}`}><strong>{item.action.toUpperCase()} · Gen {item.generation}</strong><span>{item.summary}</span>{item.aiHypothesis && <small>{item.aiHypothesis.slice(0, 500)}</small>}</div>)}</div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><div><h2>Software Evolution OS</h2><small>Observe → candidate → isolated test → canary → promote/rollback</small></div><button className='secondary' onClick={generateSoftwareUpgrades}>Generate Upgrades</button></div>{softwareUpgrades.length === 0 ? <p className='empty'>The daily innovation cycle will generate evidence-based software upgrades.</p> : <div className='priorityList'>{softwareUpgrades.slice(0, 6).map(upgrade => { const run = releaseRuns.find(item => item.upgradeId === upgrade.id); return <div className='priorityItem' key={upgrade.id}><strong>{upgrade.title} · Priority {upgrade.priority}/100</strong><span>{upgrade.category.toUpperCase()} · {upgrade.risk.toUpperCase()} RISK · {upgrade.autonomy === 'auto-safe' ? 'AUTO-SAFE' : 'RELEASE GATE'} · {upgrade.status.toUpperCase()}</span><span>{upgrade.hypothesis}</span><small>Success: {upgrade.successMetric} · Rollback: {upgrade.rollbackTrigger}</small>{run && <><span>Release: {run.stage.toUpperCase()} · baseline {run.baselineFitness} → candidate {run.candidateScore}</span><small>{run.policyNotes}</small></>}{upgrade.status === 'proposed' && <div className='alertActions'><button onClick={() => decideUpgrade(upgrade.id, 'approved')}>Approve Gate</button><button className='secondary' onClick={() => decideUpgrade(upgrade.id, 'rejected')}>Reject</button></div>}{upgrade.status === 'approved' && !run && <div className='alertActions'><button onClick={() => runClosedLoop(upgrade.id)}>Run Closed Loop</button></div>}</div>; })}</div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Today's Priority Queue</h2><small>Closest to cash first</small></div>{priorityLeads.length === 0 ? <p className='empty'>No active real opportunities yet.</p> : <div className='priorityList'>{priorityLeads.map((lead, index) => <div className={'priorityItem ' + (isOverdue(lead) ? 'priorityOverdue' : '')} key={lead.id}><strong>#{index + 1} {lead.name}</strong><span>{lead.status || 'New Lead'} · {money(lead.estimatedValue)}</span><span>{lead.nextAction || 'Contact and qualify opportunity'}</span><small>{lead.nextActionDue ? `Due ${lead.nextActionDue}` : 'Set a due date'}{isOverdue(lead) ? ' · OVERDUE' : ''}</small></div>)}</div>}</section>
            <section className='grid'>
                <form className='panel' onSubmit={submit}><h2>Add Lead</h2><label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>Email<input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Market<select value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}><option>Virginia</option><option>Charlotte / Lake Norman</option><option>NYC</option><option>Other</option></select></label><label>Project<select value={form.project} onChange={e => setForm({ ...form, project: e.target.value })}><option>General Remodeling</option><option>Electrical</option><option>Bathroom</option><option>Kitchen</option><option>Addition</option><option>Fence</option><option>Roofing</option><option>Other</option></select></label><label>Estimated Value<input type='number' min='0' value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder='0' /></label><label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><button type='submit'>Add to Pipeline</button><button className='secondary' type='button' onClick={scanPublic}>Scan Public Opportunities Now</button><button className='secondary' type='button' onClick={scanGovernment}>Scan SAM.gov Now</button><button className='secondary' type='button' onClick={testThumbtack}>Run Thumbtack Test</button><button className='secondary' type='button' onClick={testGoogleAds}>Run Google Ads Test</button></form>
                <section className='panel wide'><div className='panelHead'><h2>Lead Inbox</h2><button className='secondary' onClick={() => refresh()}>Refresh</button></div>{leads.length === 0 ? <p className='empty'>No leads yet.</p> : <div className='tableWrap'><table><thead><tr><th>Lead</th><th>Market</th><th>Project</th><th>Source</th><th>Proof</th><th>Score</th><th>Value</th><th>Status</th><th>Next Action</th><th>Due</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id} className={isOverdue(lead) ? 'overdueRow' : ''}><td><b>{lead.name}</b><small>{lead.phone || lead.email || ''}</small><button className='contactNow' onClick={() => processContact(lead.id)}>Process Contact</button></td><td>{lead.market}</td><td>{lead.project}</td><td>{lead.source}</td><td>{isSynthetic(lead) ? 'DEMO/TEST' : isMarketSignal(lead) && !isContactable(lead) ? 'RAW SIGNAL' : 'VERIFIED'}</td><td>{lead.score ?? 0}</td><td><input className='miniInput valueInput' type='number' min='0' defaultValue={lead.estimatedValue || ''} placeholder='0' onBlur={e => updateOperatorField(lead.id, { estimatedValue: Number(e.target.value || 0) })} /></td><td><select className='stageSelect' value={lead.status || 'New Lead'} onChange={e => updateLeadStatus(lead.id, e.target.value)}>{PIPELINE_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></td><td><input className='miniInput actionInput' defaultValue={lead.nextAction || ''} placeholder='Next action' onBlur={e => updateOperatorField(lead.id, { nextAction: e.target.value })} /></td><td><input className='miniInput dueInput' type='date' defaultValue={lead.nextActionDue || ''} onChange={e => updateOperatorField(lead.id, { nextActionDue: e.target.value })} />{isOverdue(lead) && <small className='overdueText'>OVERDUE</small>}</td></tr>)}</tbody></table></div>}</section>
            </section>
        </main>
    );
}

export default App;