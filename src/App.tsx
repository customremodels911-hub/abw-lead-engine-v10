import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Lead = { id: string; name: string; phone?: string; email?: string; market?: string; project?: string; source?: string; status?: string; score?: number; createdAt?: string; notes?: string; estimatedValue?: number; nextAction?: string; nextActionDue?: string; lastTouch?: string; statusUpdatedAt?: string; enrichmentStatus?: string; complianceReviewRequired?: boolean; relationship?: string; reactivationReason?: string; reactivationScore?: number };
const PIPELINE_STAGES = ['New Lead', 'Contacted', 'Responded', 'Qualified', 'Estimate/Bid', 'Deposit Due', 'Won/Active', 'Cash Collected', 'Hold', 'Lost'];

function App() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [status, setStatus] = useState('Checking...');
    const [googleStatus, setGoogleStatus] = useState('Checking...');
    const [message, setMessage] = useState('');
    const [capture, setCapture] = useState<any>(null);
    const [mesh, setMesh] = useState<any>(null);
    const [revenueIntel, setRevenueIntel] = useState<any>(null);
    const [upstream, setUpstream] = useState<any>(null);
    const [relationshipGraph, setRelationshipGraph] = useState<any>(null);
    const [form, setForm] = useState({ name: '', phone: '', email: '', market: 'Virginia', project: 'General Remodeling', value: '', notes: '' });
    const [reactivation, setReactivation] = useState({ name: '', phone: '', email: '', market: 'Charlotte / Lake Norman', project: 'Bathroom', relationship: 'Past customer', priorConversation: '', value: '' });

    const refresh = async () => {
        const [leadRes, statusRes, googleRes, captureRes, meshRes, revenueRes, upstreamRes] = await Promise.all([api.get('/api/leads'), api.get('/api/integrations/thumbtack/status'), api.get('/api/integrations/google-ads/status'), api.get('/api/customer-capture-network'), api.get('/api/acquisition-mesh'), api.get('/api/revenue-intelligence'), api.get('/api/upstream-revenue')]);
        setLeads(leadRes.data.leads || []);
        setCapture(captureRes.data || null);
        setMesh(meshRes.data || null);
        setRevenueIntel(revenueRes.data || null);
        setUpstream(upstreamRes.data || null);
        const relationshipRes = await api.get('/api/relationship-graph');
        setRelationshipGraph(relationshipRes.data || null);
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

    const isSynthetic = (lead: Lead) => /test|demo|synthetic/i.test(`${lead.source || ''} ${lead.notes || ''}`);
    const isExcluded = (lead: Lead) => /susan mcmillan|(^|\s)dennis(\s|$)|stevens/i.test(lead.name || '');
    const isMarketSignal = (lead: Lead) => /public reddit|permit signal|dob job filing|government opportunity|housing bid/i.test(lead.source || '');
    const isPromotedPropertySignal = (lead: Lead) => isMarketSignal(lead) && lead.enrichmentStatus === 'matched' && Boolean(lead.phone || lead.email);
    const isVerified = (lead: Lead) => !isSynthetic(lead) && !isExcluded(lead) && (!isMarketSignal(lead) || isPromotedPropertySignal(lead)) && Boolean(lead.phone || lead.email);
    const isClosed = (lead: Lead) => ['Cash Collected', 'Lost'].includes(lead.status || '');
    const isOverdue = (lead: Lead) => Boolean(lead.nextActionDue && !isClosed(lead) && lead.nextActionDue < new Date().toISOString().slice(0, 10));
    const money = (value?: number) => '$' + Math.round(value || 0).toLocaleString();
    const stageProbability = (stage?: string) => ({ 'New Lead': 0.1, Contacted: 0.2, Responded: 0.35, Qualified: 0.5, 'Estimate/Bid': 0.65, 'Deposit Due': 0.85, 'Won/Active': 0.95, 'Cash Collected': 1, Hold: 0.1, Lost: 0 }[stage || 'New Lead'] || 0);

    const realLeads = useMemo(() => leads.filter(isVerified), [leads]);
    const syntheticLeads = useMemo(() => leads.filter(isSynthetic), [leads]);
    const marketSignals = useMemo(() => leads.filter(lead => !isSynthetic(lead) && !isExcluded(lead) && isMarketSignal(lead) && !isPromotedPropertySignal(lead)), [leads]);
    const excludedLeads = useMemo(() => leads.filter(isExcluded), [leads]);
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
    const sourceUrl = (lead: Lead) => lead.notes?.match(/https?:\/\/[^\s|]+/i)?.[0] || '';
    const actionChannel = (lead: Lead) => lead.phone ? (/thumbtack|angi|nextdoor|buildzoom|facebook|reddit/i.test(lead.source || '') ? 'TEXT NOW' : 'CALL NOW') : lead.email ? 'EMAIL NOW' : sourceUrl(lead) ? 'REPLY ON PLATFORM' : 'RESEARCH';
    const actionabilityScore = (lead: Lead) => { if (isClosed(lead) || isSynthetic(lead) || isExcluded(lead)) return 0; let score = 0; if (lead.phone) score += 30; if (lead.email) score += 24; if (sourceUrl(lead)) score += 20; score += Math.min(25, Math.round((lead.score || 0) * 0.25)); const text = `${lead.project || ''} ${lead.notes || ''}`.toLowerCase(); if (/asap|urgent|today|tomorrow|this week|this month|ready to hire|looking to hire|need a contractor|need an electrician/.test(text)) score += 15; if ((lead.estimatedValue || 0) >= 5000) score += 8; if ((lead.estimatedValue || 0) >= 15000) score += 8; if (['Responded','Qualified','Estimate/Bid','Deposit Due','Won/Active'].includes(lead.status || '')) score += 10; return Math.min(100, score); };
    const actionableCustomers = activeReal.filter(lead => actionabilityScore(lead) >= 45 && actionChannel(lead) !== 'RESEARCH').slice().sort((a, b) => actionabilityScore(b) - actionabilityScore(a)).slice(0, 8);
    const priorityLeads = activeReal.slice(0, 5);
    const realCash = cashLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const realPipeline = activeReal.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const weightedPipeline = realLeads.filter(lead => lead.status !== 'Lost').reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    const contactRate = realLeads.length ? Math.round((contactedLeads.length / realLeads.length) * 100) : 0;
    const winRate = realLeads.length ? Math.round((wonLeads.length / realLeads.length) * 100) : 0;
    const proofReady = realLeads.length > 0 && wonLeads.length > 0;
    const ledgerLeads = leads.filter(lead => !isSynthetic(lead) && !isExcluded(lead));
    const ledgerWon = ledgerLeads.filter(lead => ['Won/Active', 'Cash Collected'].includes(lead.status || ''));
    const ledgerLost = ledgerLeads.filter(lead => lead.status === 'Lost');
    const ledgerCash = ledgerLeads.filter(lead => lead.status === 'Cash Collected').reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const ledgerPipeline = ledgerLeads.filter(lead => !['Cash Collected', 'Lost'].includes(lead.status || '')).reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const ledgerWeighted = ledgerLeads.filter(lead => lead.status !== 'Lost').reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    const ledgerCloseRate = ledgerWon.length + ledgerLost.length ? Math.round((ledgerWon.length / (ledgerWon.length + ledgerLost.length)) * 100) : 0;

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

    const addReactivation = async (e: FormEvent) => { e.preventDefault(); if (!reactivation.name.trim() || (!reactivation.phone.trim() && !reactivation.email.trim())) { setMessage('Reactivation needs a customer name and a known phone or email.'); return; } try { await api.post('/api/reactivation', { ...reactivation, estimatedValue: Number(reactivation.value || 0), reactivationReason: reactivation.priorConversation }); setReactivation({ ...reactivation, name: '', phone: '', email: '', priorConversation: '', value: '' }); setMessage('Reactivation candidate added for owner review.'); await refresh(); } catch { setMessage('Could not add the reactivation candidate.'); } };

    const prepareReactivation = async (leadId: string) => { try { await api.post(`/api/reactivation/${leadId}/prepare`, {}); setMessage('Personalized reactivation draft prepared for owner review. Nothing was sent automatically.'); } catch { setMessage('Could not prepare the reactivation draft.'); } };

    const scanPublic = async () => {
        setMessage('Scanning public homeowner opportunities...');
        try {
            const response = await api.post('/api/public-opportunities/scan', {});
            setMessage(`Public scan complete: ${response.data.added || 0} new opportunities added, ${response.data.matched || 0} contacts enriched, ${response.data.contactable || 0} contact-ready opportunities now in the pipeline.`);
            await refresh();
        } catch {
            setMessage('Public opportunity source is temporarily unavailable.');
        }
    };

    return (
        <main className='shell'>
            <header className='top'><div><p className='eyebrow'>ABW ENTERPRISE</p><h1>Lead Engine V10</h1><p className='sub'>NC Custom Remodels LLC · Virginia · Charlotte / Lake Norman · NYC</p></div><div><div className={'badge ' + (status === 'READY' ? 'good' : 'warn')}>Thumbtack: {status}</div><div className={'badge ' + (googleStatus === 'READY' ? 'good' : 'warn')}>Google Ads: {googleStatus}</div><div className={'badge ' + (proofReady ? 'good' : 'warn')}>Buyer Proof: {proofReady ? 'REAL CONVERSION VERIFIED' : 'BUILDING PROOF'}</div></div></header>
            <section className='stats'><div><span>Verified opportunities</span><strong>{activeReal.length}</strong></div><div><span>Verified pipeline $</span><strong>{money(realPipeline)}</strong></div><div><span>Weighted pipeline $</span><strong>{money(weightedPipeline)}</strong></div><div><span>Cash collected $</span><strong>{money(realCash)}</strong></div><div><span>Contact rate</span><strong>{contactRate}%</strong></div><div><span>Win rate</span><strong>{winRate}%</strong></div><div><span>Raw market signals</span><strong>{marketSignals.length}</strong></div><div><span>Excluded / test</span><strong>{excludedLeads.length + syntheticLeads.length}</strong></div></section>
            <section className='panel wide'><div className='panelHead'><div><h2>V10 Opportunity Ledger</h2><small>Discover → qualify → contact → estimate → win/loss → cash. Every real opportunity stays visible so V10 can learn what produces revenue.</small></div><button className='secondary' onClick={() => refresh()}>Refresh Ledger</button></div><section className='stats'><div><span>Opportunities discovered</span><strong>{ledgerLeads.length}</strong></div><div><span>Open pipeline $</span><strong>{money(ledgerPipeline)}</strong></div><div><span>Weighted value $</span><strong>{money(ledgerWeighted)}</strong></div><div><span>Won / active</span><strong>{ledgerWon.length}</strong></div><div><span>Lost</span><strong>{ledgerLost.length}</strong></div><div><span>Close rate</span><strong>{ledgerCloseRate}%</strong></div><div><span>Cash collected $</span><strong>{money(ledgerCash)}</strong></div></section>{ledgerLeads.length === 0 ? <p className='empty'>The ledger will populate automatically as V10 discovers or receives opportunities.</p> : <div className='tableWrap'><table><thead><tr><th>Discovered</th><th>Opportunity</th><th>Source</th><th>Market</th><th>Project</th><th>Score</th><th>Potential $</th><th>Stage</th><th>Expected $</th><th>Next Action</th><th>Outcome</th></tr></thead><tbody>{ledgerLeads.slice().sort((a,b) => Date.parse(b.createdAt || '1970-01-01') - Date.parse(a.createdAt || '1970-01-01')).map(lead => <tr key={'ledger-'+lead.id} className={isOverdue(lead) ? 'overdueRow' : ''}><td>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}</td><td><b>{lead.name}</b></td><td>{lead.source || 'Unknown'}</td><td>{lead.market || '—'}</td><td>{lead.project || '—'}</td><td>{lead.score ?? 0}</td><td>{money(lead.estimatedValue)}</td><td>{lead.status || 'New Lead'}</td><td>{money((lead.estimatedValue || 0) * stageProbability(lead.status))}</td><td>{lead.nextAction || 'Contact and qualify opportunity'}</td><td>{lead.status === 'Cash Collected' ? 'CASH' : lead.status === 'Lost' ? 'LOST' : lead.status === 'Won/Active' ? 'WON' : 'OPEN'}</td></tr>)}</tbody></table></div>}</section>
            <section className='panel wide'><div className='panelHead'><div><h2>Revenue Intelligence Engine</h2><small>V10 learns from actual wins, losses and cash — then ranks the opportunities most likely to produce the next dollar.</small></div><button className='secondary' onClick={() => refresh()}>Recalculate</button></div><section className='stats'><div><span>Learned close rate</span><strong>{revenueIntel?.summary?.closeRate || 0}%</strong></div><div><span>Cash attributed</span><strong>{money(revenueIntel?.summary?.cashCollected || 0)}</strong></div><div><span>Weighted pipeline</span><strong>{money(revenueIntel?.summary?.weightedPipeline || 0)}</strong></div><div><span>Avg days to cash</span><strong>{revenueIntel?.summary?.avgDaysToCash ?? '—'}</strong></div></section><h3>Money-Now Queue</h3>{!revenueIntel?.moneyNowQueue?.length ? <p className='empty'>Money-Now rankings will appear as verified opportunities enter the pipeline.</p> : <div className='priorityList'>{revenueIntel.moneyNowQueue.slice(0,8).map((item:any,index:number) => <div className='priorityItem' key={'money-now-'+item.id}><strong>#{index + 1} {item.name} · Money-Now {item.moneyNowScore}/100</strong><span>{item.status} · {item.closeProbability}% modeled close · expected cash {money(item.expectedCashValue)}</span><span>{item.project} · {item.market} · {item.source}</span><small>{item.reason}</small><small>{item.nextAction}</small></div>)}</div>}<h3>Where Cash Is Coming From</h3>{!revenueIntel?.sourcePerformance?.length ? <p className='empty'>Source learning starts after real outcomes are recorded.</p> : <div className='tableWrap'><table><thead><tr><th>Source</th><th>Opps</th><th>Wins</th><th>Close</th><th>Cash</th><th>Cash / Opp</th><th>Learned Win</th></tr></thead><tbody>{revenueIntel.sourcePerformance.slice(0,8).map((row:any) => <tr key={'ri-source-'+row.name}><td><b>{row.name}</b></td><td>{row.opportunities}</td><td>{row.wins}</td><td>{row.closeRate}%</td><td>{money(row.cash)}</td><td>{money(row.cashPerOpportunity)}</td><td>{row.learnedWinRate}%</td></tr>)}</tbody></table></div>}<h3>Market Intelligence</h3><div className='tableWrap'><table><thead><tr><th>Market</th><th>Opps</th><th>Wins</th><th>Cash</th><th>Pipeline</th><th>Learned Win</th></tr></thead><tbody>{(revenueIntel?.marketPerformance || []).slice(0,6).map((row:any) => <tr key={'ri-market-'+row.name}><td><b>{row.name}</b></td><td>{row.opportunities}</td><td>{row.wins}</td><td>{money(row.cash)}</td><td>{money(row.openPipeline)}</td><td>{row.learnedWinRate}%</td></tr>)}</tbody></table></div><h3>Project Intelligence</h3><div className='tableWrap'><table><thead><tr><th>Project</th><th>Opps</th><th>Wins</th><th>Cash</th><th>Cash / Opp</th><th>Learned Win</th></tr></thead><tbody>{(revenueIntel?.projectPerformance || []).slice(0,6).map((row:any) => <tr key={'ri-project-'+row.name}><td><b>{row.name}</b></td><td>{row.opportunities}</td><td>{row.wins}</td><td>{money(row.cash)}</td><td>{money(row.cashPerOpportunity)}</td><td>{row.learnedWinRate}%</td></tr>)}</tbody></table></div></section>
            <section className='panel wide'><div className='panelHead'><div><h2>Relationship Graph</h2><small>Capital event → owner → prime → trade package → lawful entry point → next action.</small></div></div>{!(relationshipGraph?.chains || []).length ? <p className='empty'>Relationship chains will appear as upstream targets are verified.</p> : <div className='priorityList'>{relationshipGraph.chains.map((chain:any) => <div className='priorityItem' key={'graph-'+chain.program}><strong>{chain.program}</strong><span>{chain.signal}</span><span>{chain.nodes.join(' → ')}</span><small><b>Entry:</b> {chain.entryPoint}</small><small><b>Qualification:</b> {chain.qualificationRoute}</small><small><b>Next:</b> {chain.nextAction}</small></div>)}</div>}</section>
            <section className='panel wide'><div className='panelHead'><div><h2>Upstream Revenue Qualification Engine</h2><small>Find capital events before normal leads appear, then route each target into the lawful path you can pursue now.</small></div><button className='secondary' onClick={() => refresh()}>Refresh Qualification</button></div><div className='priorityList'>{(upstream?.targets || []).map((item:any) => <div className='priorityItem' key={'upstream-'+item.name}><strong>{item.name} · {item.route}</strong><span>{item.type} · {item.market}</span><span>{item.opportunity}</span><small>{item.qualification}</small><small><b>Next move:</b> {item.nextMove}</small></div>)}</div><h3>Qualification Rules V10 Must Enforce</h3><div className='tableWrap'><table><thead><tr><th>Rule</th><th>Current Status</th><th>V10 Routing</th></tr></thead><tbody>{(upstream?.qualificationRules || []).map((row:any) => <tr key={'rule-'+row.rule}><td><b>{row.rule}</b></td><td>{row.status}</td><td>{row.route}</td></tr>)}</tbody></table></div><h3>Current Unlock Sequence</h3><div className='priorityList'>{(upstream?.unlockSequence || []).map((step:any,index:number) => <div className='priorityItem' key={'unlock-'+index}><strong>#{index+1} {step.title}</strong><span>{step.reason}</span><small>{step.result}</small></div>)}</div></section>
            {message && <div className='notice'>{message}</div>}
            <section className='panel priorityPanel'><div className='panelHead'><h2>Revenue Proof</h2><small>Only verified, contactable opportunities count toward pipeline</small></div><div className='priorityList'><div className='priorityItem'><strong>{wonLeads.length} verified wins</strong><span>{cashLeads.length} cash-collected records · {money(realCash)} attributed revenue</span><small>{proofReady ? 'Buyer proof chain has at least one real converted opportunity.' : 'Next milestone: move one verified opportunity through Won/Active and Cash Collected.'}</small></div></div></section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Source Performance</h2><small>Shows buyers where pipeline and revenue originate</small></div>{sourcePerformance.length === 0 ? <p className='empty'>No real source data yet.</p> : <div className='tableWrap'><table><thead><tr><th>Source</th><th>Real Leads</th><th>Wins</th><th>Open Pipeline</th><th>Cash</th></tr></thead><tbody>{sourcePerformance.map(row => <tr key={row.source}><td><b>{row.source}</b></td><td>{row.leads}</td><td>{row.won}</td><td>{money(row.pipeline)}</td><td>{money(row.cash)}</td></tr>)}</tbody></table></div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Adaptive Acquisition Mesh</h2><small>V10 learns where opportunities originate, explores under-tested channels, and rescues decaying pipeline</small></div><div className='captureMetrics'><div><span>Strategy Gen</span><strong>{mesh?.genome?.generation || 1}</strong></div><div><span>Feed Models</span><strong>{mesh?.rankedSources?.length || 0}</strong></div><div><span>Rescue Queue</span><strong>{mesh?.rescue?.count || 0}</strong></div><div><span>Explore Rate</span><strong>{mesh?.genome?.explorationMultiplier || 1}x</strong></div></div><h3>Feed Allocation</h3>{!mesh?.rankedSources?.length ? <p className='empty'>Source learning begins as scans accumulate evidence.</p> : <div className='tableWrap'><table><thead><tr><th>Feed</th><th>Market</th><th>Mode</th><th>Learned Yield</th><th>Added / Scanned</th></tr></thead><tbody>{mesh.rankedSources.slice(0,10).map((row:any) => <tr key={row.sourceId}><td><b>{row.label}</b></td><td>{row.market}</td><td>{row.allocation}</td><td>{row.learnedYield}%</td><td>{row.added} / {row.scanned}</td></tr>)}</tbody></table></div>}<h3>Opportunity Rescue</h3>{!mesh?.rescue?.candidates?.length ? <p className='empty'>No valuable dormant opportunities need rescue right now.</p> : <div className='priorityList'>{mesh.rescue.candidates.slice(0,5).map((lead:any) => <div className='priorityItem' key={'rescue-'+lead.id}><strong>{lead.name} · Rescue {lead.rescueScore}</strong><span>{lead.project} · {money(lead.estimatedValue)} · quiet {lead.ageDays}d</span><small>{lead.action}</small></div>)}</div>}<h3>Non-obvious Strategy Layer</h3><div className='priorityList'>{(mesh?.adjacentChannels || []).map((item:any) => <div className='priorityItem' key={item.channel}><strong>{item.channel}</strong><span>{item.mode}</span><small>{item.tactic}</small></div>)}</div></section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Customer Capture Network</h2><small>Intent → contact → appointment → estimate → win → cash</small></div><div className='captureMetrics'><div><span>Signals</span><strong>{capture?.metrics?.signals || 0}</strong></div><div><span>Contact Now</span><strong>{capture?.metrics?.actionable || 0}</strong></div><div><span>Qualified</span><strong>{capture?.metrics?.qualified || 0}</strong></div><div><span>Estimates</span><strong>{capture?.metrics?.estimates || 0}</strong></div><div><span>Wins</span><strong>{capture?.metrics?.wins || 0}</strong></div><div><span>Cash</span><strong>{money(capture?.metrics?.cashCollected || 0)}</strong></div></div><h3>Customer Before Competitor</h3>{!capture?.interceptQueue?.length ? <p className='empty'>No immediate intercept opportunities yet.</p> : <div className='priorityList'>{capture.interceptQueue.slice(0,5).map((lead: any, index: number) => <div className='priorityItem interceptItem' key={'intercept-'+lead.id}><strong>#{index + 1} {lead.name}</strong><span className='actionTag'>{lead.actionChannel} · CBC {lead.customerBeforeCompetitorScore}</span><span>{lead.project} · {lead.market}</span><span>{money(lead.estimatedValue)} · {lead.source}</span><small>{lead.nextAction}</small></div>)}</div>}<h3>Source Economics</h3>{!capture?.sourceEconomics?.length ? <p className='empty'>Conversion data will appear as customers move through the pipeline.</p> : <div className='tableWrap'><table><thead><tr><th>Source</th><th>Leads</th><th>Actionable</th><th>Qualified+</th><th>Wins</th><th>Cash</th></tr></thead><tbody>{capture.sourceEconomics.slice(0,8).map((row: any) => <tr key={'capture-source-'+row.source}><td><b>{row.source}</b></td><td>{row.leads}</td><td>{row.actionable}</td><td>{row.appointments}</td><td>{row.wins}</td><td>{money(row.cash)}</td></tr>)}</tbody></table></div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Actionable Customer Queue</h2><small>Only prospects with a real contact path and sufficient intent</small></div>{actionableCustomers.length === 0 ? <p className='empty'>No contact-ready customers yet. Run a public scan or add a qualified inquiry.</p> : <div className='priorityList'>{actionableCustomers.map((lead, index) => <div className='priorityItem actionableItem' key={'actionable-'+lead.id}><strong>#{index + 1} {lead.name}</strong><span className='actionTag'>{actionChannel(lead)} · Score {actionabilityScore(lead)}</span><span>{lead.project} · {lead.market}</span><span>{money(lead.estimatedValue)} · {lead.source}</span><small>{lead.phone || lead.email || sourceUrl(lead)}</small><button className='secondary' type='button' onClick={() => updateOperatorField(lead.id, { nextAction: actionChannel(lead) === 'CALL NOW' ? 'Call customer now and qualify scope, budget and timing' : actionChannel(lead) === 'TEXT NOW' ? 'Text customer now and request project details/photos' : actionChannel(lead) === 'EMAIL NOW' ? 'Email customer now and request project details/photos' : 'Open platform post and reply now' })}>Set Money-Now Action</button></div>)}</div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Today's Priority Queue</h2><small>Closest to cash first</small></div>{priorityLeads.length === 0 ? <p className='empty'>No active real opportunities yet.</p> : <div className='priorityList'>{priorityLeads.map((lead, index) => <div className={'priorityItem ' + (isOverdue(lead) ? 'priorityOverdue' : '')} key={lead.id}><strong>#{index + 1} {lead.name}</strong><span>{lead.status || 'New Lead'} · {money(lead.estimatedValue)}</span><span>{lead.nextAction || 'Contact and qualify opportunity'}</span><small>{nextActionLabel(lead, isOverdue(lead))}</small></div>)}</div>}</section>
            <section className='panel priorityPanel'><div className='panelHead'><h2>Demand Creation / Reactivation</h2><small>Turn past customers, old estimates and dormant conversations back into opportunities — review before contact</small></div><form onSubmit={addReactivation}><label>Customer<input value={reactivation.name} onChange={e => setReactivation({ ...reactivation, name: e.target.value })} placeholder='Past customer or old inquiry' /></label><label>Known phone<input value={reactivation.phone} onChange={e => setReactivation({ ...reactivation, phone: e.target.value })} /></label><label>Known email<input value={reactivation.email} onChange={e => setReactivation({ ...reactivation, email: e.target.value })} /></label><label>Relationship<select value={reactivation.relationship} onChange={e => setReactivation({ ...reactivation, relationship: e.target.value })}><option>Past customer</option><option>Old estimate</option><option>Prior inquiry</option><option>Referral</option></select></label><label>Project<select value={reactivation.project} onChange={e => setReactivation({ ...reactivation, project: e.target.value })}><option>Bathroom</option><option>Kitchen</option><option>Electrical</option><option>Addition</option><option>Fence</option><option>General Remodeling</option></select></label><label>Market<select value={reactivation.market} onChange={e => setReactivation({ ...reactivation, market: e.target.value })}><option>Charlotte / Lake Norman</option><option>Virginia</option><option>NYC</option><option>Other</option></select></label><label>Potential value<input type='number' min='0' value={reactivation.value} onChange={e => setReactivation({ ...reactivation, value: e.target.value })} /></label><label>What did we discuss?<textarea value={reactivation.priorConversation} onChange={e => setReactivation({ ...reactivation, priorConversation: e.target.value })} placeholder='Example: talked about bathroom two years ago; customer wanted to wait' /></label><button type='submit'>Add Reactivation Opportunity</button></form><div className='priorityList'>{leads.filter(lead => lead.source === 'V10 Reactivation' && !isClosed(lead)).slice().sort((a,b) => (b.reactivationScore || b.score || 0) - (a.reactivationScore || a.score || 0)).slice(0,5).map(lead => <div className='priorityItem' key={'reactivation-'+lead.id}><strong>{lead.name} · score {lead.reactivationScore || lead.score || 0}</strong><span>{lead.relationship || 'Prior relationship'} · {lead.project} · {money(lead.estimatedValue)}</span><small>{lead.reactivationReason || lead.notes}</small><button className='secondary' type='button' onClick={() => prepareReactivation(lead.id)}>Prepare Personal Follow-Up</button></div>)}</div></section>
            <section className='grid'>
                <form className='panel' onSubmit={submit}><h2>Add Lead</h2><label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>Email<input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Market<select value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}><option>Virginia</option><option>Charlotte / Lake Norman</option><option>NYC</option><option>Other</option></select></label><label>Project<select value={form.project} onChange={e => setForm({ ...form, project: e.target.value })}><option>General Remodeling</option><option>Electrical</option><option>Bathroom</option><option>Kitchen</option><option>Addition</option><option>Fence</option><option>Roofing</option><option>Other</option></select></label><label>Estimated Value<input type='number' min='0' value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder='0' /></label><label>Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><button type='submit'>Add to Pipeline</button><button className='secondary' type='button' onClick={scanPublic}>Scan Public Opportunities Now</button><button className='secondary' type='button' onClick={testThumbtack}>Run Thumbtack Test</button><button className='secondary' type='button' onClick={testGoogleAds}>Run Google Ads Test</button></form>
                <section className='panel wide'><div className='panelHead'><h2>Lead Inbox</h2><button className='secondary' onClick={() => refresh()}>Refresh</button></div>{leads.length === 0 ? <p className='empty'>No leads yet.</p> : <div className='tableWrap'><table><thead><tr><th>Lead</th><th>Market</th><th>Project</th><th>Source</th><th>Proof</th><th>Score</th><th>Value</th><th>Status</th><th>Next Action</th><th>Due</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id} className={isOverdue(lead) ? 'overdueRow' : ''}><td><b>{lead.name}</b><small>{lead.phone || lead.email || ''}</small></td><td>{lead.market}</td><td>{lead.project}</td><td>{lead.source}</td><td>{isSynthetic(lead) ? 'DEMO/TEST' : isExcluded(lead) ? 'EXCLUDED' : isPromotedPropertySignal(lead) ? 'CONTACT READY — REVIEW' : isMarketSignal(lead) ? 'SIGNAL — VERIFY' : isVerified(lead) ? 'VERIFIED' : 'UNVERIFIED'}</td><td>{lead.score ?? 0}</td><td><input className='miniInput valueInput' type='number' min='0' defaultValue={lead.estimatedValue || ''} placeholder='0' onBlur={e => updateOperatorField(lead.id, { estimatedValue: Number(e.target.value || 0) })} /></td><td><select className='stageSelect' value={lead.status || 'New Lead'} onChange={e => updateLeadStatus(lead.id, e.target.value)}>{PIPELINE_STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></td><td><input className='miniInput actionInput' defaultValue={lead.nextAction || ''} placeholder='Next action' onBlur={e => updateOperatorField(lead.id, { nextAction: e.target.value })} /></td><td><input className='miniInput dueInput' type='date' defaultValue={lead.nextActionDue || ''} onChange={e => updateOperatorField(lead.id, { nextActionDue: e.target.value })} />{isOverdue(lead) && <small className='overdueText'>OVERDUE</small>}</td></tr>)}</tbody></table></div>}</section>
            </section>
        </main>
    );
}

function nextActionLabel(lead: Lead, overdue: boolean) {
    return `${lead.nextActionDue ? `Due ${lead.nextActionDue}` : 'Set a due date'}${overdue ? ' · OVERDUE' : ''}`;
}

export default App;
