import { ai, db, error, json, router, secrets } from '@appdeploy/sdk';
import { createHmac, timingSafeEqual } from 'node:crypto';

type IncomingLead = { name?: string; phone?: string; email?: string; market?: string; project?: string; source?: string; notes?: string; value?: number; nextAction?: string; nextActionDue?: string; event?: string; lead_id?: string; request?: { name?: string; phone?: string; email?: string; category?: string; description?: string; location?: string } };

type ThumbtackNegotiation = { negotiationID?: string; category?: { name?: string }; customer?: { displayName?: string; phoneNumber?: string; email?: string; location?: { city?: string; state?: string; zipCode?: string } }; details?: Array<{ question?: string; answer?: string }>; createTime?: string };
type GoogleLeadColumn = { column_id?: string; column_name?: string; string_value?: string };
type GoogleAdsLead = { lead_id?: string; campaign_id?: number | string; form_id?: number | string; adgroup_id?: number | string; creative_id?: number | string; gcl_id?: string; google_key?: string; Google_key?: string; is_test?: boolean; user_column_data?: GoogleLeadColumn[] };
type BatchDataSkipTraceRequest = { address?: string; city?: string; state?: string; zip?: string; firstName?: string; lastName?: string };

function decodeBase64(value: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    let index = 0;
    value = value.replace(/[^A-Za-z0-9+/=]/g, '');
    while (index < value.length) {
        const e1 = chars.indexOf(value.charAt(index++));
        const e2 = chars.indexOf(value.charAt(index++));
        const e3 = chars.indexOf(value.charAt(index++));
        const e4 = chars.indexOf(value.charAt(index++));
        const c1 = (e1 << 2) | (e2 >> 4);
        const c2 = ((e2 & 15) << 4) | (e3 >> 2);
        const c3 = ((e3 & 3) << 6) | e4;
        output += String.fromCharCode(c1);
        if (e3 !== 64 && e3 !== -1) output += String.fromCharCode(c2);
        if (e4 !== 64 && e4 !== -1) output += String.fromCharCode(c3);
    }
    return output;
}

function thumbtackToLead(body: unknown): IncomingLead {
    const root = (body || {}) as Record<string, unknown>;
    const candidate = (root.negotiation || root.data || body || {}) as Record<string, unknown>;
    const nested = (candidate.negotiation || candidate) as ThumbtackNegotiation;
    const location = nested.customer?.location;
    const market = [location?.city, location?.state, location?.zipCode].filter(Boolean).join(', ');
    const notes = (nested.details || []).map(item => `${item.question || 'Detail'}: ${item.answer || ''}`).join(' | ');
    return {
        name: nested.customer?.displayName || 'Thumbtack Lead',
        phone: nested.customer?.phoneNumber || '',
        email: nested.customer?.email || '',
        market: market || 'Other',
        project: nested.category?.name || 'General Remodeling',
        source: 'Thumbtack',
        notes,
        lead_id: nested.negotiationID || ''
    };
}

function googleAdsToLead(body: GoogleAdsLead): IncomingLead {
    const columns = body.user_column_data || [];
    const value = (...ids: string[]) => columns.find(column => ids.includes((column.column_id || '').toUpperCase()))?.string_value || '';
    const first = value('FIRST_NAME');
    const last = value('LAST_NAME');
    const fullName = value('FULL_NAME') || [first, last].filter(Boolean).join(' ');
    const phone = value('PHONE_NUMBER', 'WORK_PHONE');
    const emailAddress = value('EMAIL', 'WORK_EMAIL');
    const postalCode = value('POSTAL_CODE');
    const standardIds = new Set(['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'PHONE_NUMBER', 'WORK_PHONE', 'EMAIL', 'WORK_EMAIL', 'POSTAL_CODE']);
    const customAnswers = columns.filter(column => !standardIds.has((column.column_id || '').toUpperCase()) && column.string_value).map(column => `${column.column_name || column.column_id || 'Detail'}: ${column.string_value}`);
    const metadata = [`Campaign: ${body.campaign_id || 'unknown'}`, `Form: ${body.form_id || 'unknown'}`, body.gcl_id ? `GCLID: ${body.gcl_id}` : '', ...customAnswers].filter(Boolean).join(' | ');
    return {
        name: fullName || 'Google Ads Lead',
        phone,
        email: emailAddress,
        market: postalCode ? `ZIP ${postalCode}` : 'Google Ads',
        project: 'Google Ads Lead Form',
        source: body.is_test ? 'Google Ads Test' : 'Google Ads',
        notes: metadata,
        lead_id: body.lead_id ? `google:${body.lead_id}` : ''
    };
}

type Lead = { name: string; phone: string; email: string; market: string; project: string; source: string; notes: string; status: string; score: number; createdAt: string; externalId: string; estimatedValue: number; nextAction: string; nextActionDue: string; lastTouch: string; statusUpdatedAt: string; enrichmentProvider?: string; enrichmentStatus?: string; enrichmentUpdatedAt?: string; complianceReviewRequired?: boolean };
type BatchContact = { phone: string; email: string; dnc: boolean; tcpaRisk: boolean };
type OutreachEvent = { leadId: string; leadName: string; channel: 'email' | 'owner-alert'; destination: string; status: 'sent' | 'queued' | 'failed'; reason: string; createdAt: string };
type OwnerAlert = { leadId: string; leadName: string; market: string; project: string; phone: string; email: string; sourceUrl: string; instruction: string; status: 'open' | 'resolved'; createdAt: string; resolvedAt: string };
type SourceIntelligence = { sourceId: string; label: string; market: string; runs: number; scanned: number; added: number; failures: number; posteriorMean: number; explorationScore: number; nextScanAt: string; lastRunAt: string; lastError: string; lastAdded: number; lastScanned: number };
type StrategyGenome = { generation: number; createdAt: string; updatedAt: string; explorationMultiplier: number; staleLeadBoost: number; valuePriorityCap: number; followUpHours: number; marketWeights: Record<string, number>; fitness: number; baselineFitness: number; parentGeneration: number; status: 'active' | 'archived' | 'rolled-back'; lastReason: string };
type EvolutionRecord = { createdAt: string; generation: number; priorGeneration: number; fitness: number; action: 'initialized' | 'evolved' | 'rolled-back' | 'innovation'; summary: string; aiHypothesis: string; genome: StrategyGenome };
type SoftwareUpgrade = { createdAt: string; title: string; hypothesis: string; category: 'revenue' | 'reliability' | 'automation' | 'acquisition' | 'conversion'; risk: 'low' | 'medium' | 'high'; autonomy: 'auto-safe' | 'gated'; expectedImpact: number; confidence: number; priority: number; status: 'proposed' | 'approved' | 'rejected'; successMetric: string; rollbackTrigger: string; evidence: string };
type ReleaseRun = { upgradeId: string; title: string; createdAt: string; updatedAt: string; stage: 'candidate' | 'isolated-test' | 'canary' | 'promoted' | 'rolled-back' | 'deployment-ready' | 'rejected-policy'; autonomy: 'auto-safe' | 'gated'; baselineFitness: number; candidateScore: number; staticPassed: boolean; policyNotes: string; patchPackage: string; tests: string[]; canaryMetric: string; rollbackPlan: string; rollbackGenome: StrategyGenome; promotedGenome?: StrategyGenome };
type MecklenburgPermit = { permit_number?: string; permit_status?: string; permit_type?: string; description?: string; description_of_work?: string; type_of_work?: string; project_name?: string; project_address?: string; issue_date?: number | string; building_construction_cost_customer?: number | string; building_construction_cost_system?: number | string; owner_name?: string; owner_phone?: string; owner_email_address?: string; owner_city?: string; owner_state?: string; owner_zip_code?: string; is_issued?: number | string; is_not_cancelled?: number | string };

type RedditListing = { data?: { children?: Array<{ data?: { id?: string; title?: string; selftext?: string; author?: string; permalink?: string; created_utc?: number } }> } };
type NycJobFiling = { job_filing_number?: string; house_no?: string; street_name?: string; borough?: string; work_on_floor?: string; work_type?: string; job_description?: string; filing_status?: string; initial_cost?: string; owner_s_business_name?: string; applicant_business_name?: string };
type SamPointOfContact = { email?: string; phone?: string; fullName?: string; type?: string };
type SamOpportunity = { noticeId?: string; title?: string; solicitationNumber?: string; postedDate?: string; type?: string; baseType?: string; typeOfSetAsideDescription?: string; typeOfSetAside?: string; responseDeadLine?: string; naicsCode?: string; active?: string; fullParentPathName?: string; pointOfContact?: SamPointOfContact[]; placeOfPerformance?: { city?: { name?: string }; state?: { code?: string; name?: string }; zip?: string }; uiLink?: string };
type SamOpportunityResponse = { totalRecords?: number; opportunitiesData?: SamOpportunity[] };

const PUBLIC_KEYWORDS = ['contractor', 'general contractor', 'remodel', 'remodeling', 'renovation', 'addition', 'add on', 'room addition', 'garage conversion', 'electrician', 'electrical', 'panel', 'outlet', 'fence', 'fencing', 'bathroom', 'shower', 'walk-in shower', 'tub', 'accessibility', 'handicap', 'kitchen', 'cabinet', 'deck', 'porch', 'flooring', 'drywall', 'roof', 'roofing', 'chimney', 'structural', 'water damage', 'handyman', 'repair', 'rehab', 'full rehab', 'whole home', 'home improvement', 'basement', 'tile', 'siding'];
const DEMAND_PHRASES = ['looking for', 'need ', 'i need', 'we need', 'i want', 'we want', 'want to', 'recommend', 'recommendation', 'quote', 'estimate', 'pricing', 'cost', 'how much', 'planning', 'seeking', 'anyone know', 'who can', 'hire', 'hiring a contractor', 'contractor needed', 'repair or replace', 'available contractor', 'licensed contractor'];
const HIGH_INTENT_PHRASES = ['looking for a contractor', 'need a contractor', 'need an electrician', 'need someone to', 'looking to hire', 'ready to hire', 'quote', 'estimate', 'asap', 'urgent', 'this week', 'this month', 'soon'];
const NEGATIVE_INTENT_PHRASES = ['i am a contractor', 'i\'m a contractor', 'contractor here', 'looking for work', 'seeking employment', 'job opening', 'career advice', 'how do i become', 'diy only', 'just showing'];

function classifyProject(text: string): string {
    const value = text.toLowerCase();
    if (value.includes('electric')) return 'Electrical';
    if (value.includes('fence')) return 'Fence';
    if (value.includes('bath') || value.includes('shower') || value.includes('tub')) return 'Bathroom';
    if (value.includes('kitchen') || value.includes('cabinet')) return 'Kitchen';
    if (value.includes('addition') || value.includes('add on') || value.includes('garage conversion') || value.includes('new room')) return 'Addition';
    if (value.includes('roof') || value.includes('chimney')) return 'Roofing';
    if (value.includes('deck') || value.includes('porch')) return 'Deck / Porch';
    if (value.includes('floor')) return 'Flooring';
    return 'General Remodeling';
}

function intentStrength(text: string): number {
    const value = text.toLowerCase();
    if (!PUBLIC_KEYWORDS.some(keyword => value.includes(keyword))) return 0;
    if (NEGATIVE_INTENT_PHRASES.some(phrase => value.includes(phrase))) return 0;
    let strength = 20;
    strength += Math.min(25, DEMAND_PHRASES.filter(phrase => value.includes(phrase)).length * 5);
    strength += Math.min(30, HIGH_INTENT_PHRASES.filter(phrase => value.includes(phrase)).length * 10);
    if (/\b(home|house|property|condo|apartment|bathroom|kitchen|yard|garage|basement)\b/.test(value)) strength += 10;
    if (/\b(asap|urgent|today|tomorrow|this week|this month|soon)\b/.test(value)) strength += 10;
    return Math.min(strength, 100);
}

function looksLikeOpportunity(text: string): boolean {
    return intentStrength(text) >= 35;
}

function inferredProjectValue(project: string): number {
    const values: Record<string, number> = {
        Addition: 45000,
        Kitchen: 18000,
        Bathroom: 12000,
        Roofing: 10000,
        Electrical: 3500,
        Fence: 6500,
        'Deck / Porch': 9000,
        Flooring: 5000,
        'General Remodeling': 7500
    };
    return values[project] || 5000;
}

function opportunityFingerprint(text: string, market: string): string {
    const normalized = text.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    return `${market.toLowerCase()}:${normalized}`;
}

async function recentLeadKeys(): Promise<{ externalIds: Set<string>; fingerprints: Set<string> }> {
    const { items } = await db.list<Lead>('leads', { limit: 100 });
    const externalIds = new Set(items.map(item => item.externalId).filter(Boolean));
    const fingerprints = new Set(items.map(item => opportunityFingerprint(item.notes || item.name || '', item.market || '')).filter(Boolean));
    return { externalIds, fingerprints };
}

async function recentExternalIds(): Promise<Set<string>> {
    return (await recentLeadKeys()).externalIds;
}

function adaptiveDelayMinutes(state: SourceIntelligence): number {
    if (state.failures >= 3 && state.added === 0) return 180;
    if (state.posteriorMean >= 0.08) return 10;
    if (state.posteriorMean >= 0.03) return 20;
    if (state.posteriorMean >= 0.01) return 45;
    return 90;
}

async function sourceState(sourceId: string, label: string, market: string): Promise<SourceIntelligence & { id?: string }> {
    const { items } = await db.list<SourceIntelligence>('source_intelligence', { limit: 50 });
    const existing = items.find(item => item.sourceId === sourceId);
    if (existing) return existing;
    return { sourceId, label, market, runs: 0, scanned: 0, added: 0, failures: 0, posteriorMean: 0.5, explorationScore: 1, nextScanAt: '', lastRunAt: '', lastError: '', lastAdded: 0, lastScanned: 0 };
}

async function runAdaptiveSource(sourceId: string, label: string, market: string, run: () => Promise<{ added: number; scanned: number }>, force = false): Promise<{ added: number; scanned: number; skipped?: boolean; sourceId: string }> {
    const state = await sourceState(sourceId, label, market);
    if (!force && state.nextScanAt && Date.parse(state.nextScanAt) > Date.now()) return { added: 0, scanned: 0, skipped: true, sourceId };
    try {
        const result = await run();
        const runs = state.runs + 1;
        const scanned = state.scanned + result.scanned;
        const added = state.added + result.added;
        const posteriorMean = (added + 1) / (scanned + 2);
        const explorationScore = posteriorMean + Math.sqrt(2 * Math.log(runs + 2) / Math.max(1, runs));
        const nextState: SourceIntelligence = { ...state, sourceId, label, market, runs, scanned, added, posteriorMean, explorationScore, failures: state.failures, lastRunAt: new Date().toISOString(), lastError: '', lastAdded: result.added, lastScanned: result.scanned, nextScanAt: '' };
        nextState.nextScanAt = new Date(Date.now() + adaptiveDelayMinutes(nextState) * 60000).toISOString();
        if (state.id) await db.update('source_intelligence', [{ id: state.id, record: nextState }]);
        else await db.add('source_intelligence', [nextState]);
        return { ...result, sourceId };
    } catch (err) {
        const nextState: SourceIntelligence = { ...state, sourceId, label, market, runs: state.runs + 1, failures: state.failures + 1, lastRunAt: new Date().toISOString(), lastError: String(err).slice(0, 240), lastAdded: 0, lastScanned: 0, nextScanAt: new Date(Date.now() + Math.min(240, 30 * (state.failures + 1)) * 60000).toISOString() };
        if (state.id) await db.update('source_intelligence', [{ id: state.id, record: nextState }]);
        else await db.add('source_intelligence', [nextState]);
        throw err;
    }
}

async function scanMecklenburgPermitSignals(): Promise<{ added: number; scanned: number }> {
    const fields = ['permit_number','permit_status','permit_type','description','description_of_work','type_of_work','project_name','project_address','issue_date','building_construction_cost_customer','building_construction_cost_system','owner_name','owner_phone','owner_email_address','owner_city','owner_state','owner_zip_code'].join(',');
    const params = new URLSearchParams({ where: '1=1', outFields: fields, returnGeometry: 'false', orderByFields: 'issue_date DESC', resultRecordCount: '150', f: 'json' });
    const url = `https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/FeatureServer/0/query?${params.toString()}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'ABWLeadEngineV10/3.2 permit-signal-monitor' } });
    if (!response.ok) throw new Error(`Mecklenburg permits returned ${response.status}`);
    const payload = await response.json() as { features?: Array<{ attributes?: MecklenburgPermit }> };
    const rows = (payload.features || []).map(item => item.attributes || {});
    const known = await recentLeadKeys();
    let added = 0;
    for (const row of rows) {
        const permit = String(row.permit_number || '');
        if (!permit) continue;
        const externalId = `meck-permit:${permit}`;
        if (known.externalIds.has(externalId)) continue;
        const scope = `${row.project_name || ''} ${row.description || ''} ${row.description_of_work || ''} ${row.type_of_work || ''} ${row.permit_type || ''}`.trim();
        const project = classifyProject(scope);
        const relevant = PUBLIC_KEYWORDS.some(keyword => scope.toLowerCase().includes(keyword)) || ['Electrical', 'Bathroom', 'Kitchen', 'Addition', 'Roofing', 'Deck / Porch', 'Flooring'].includes(project);
        if (!relevant) continue;
        const issuedMs = Number(row.issue_date || 0);
        if (issuedMs && Date.now() - issuedMs > 45 * 86400000) continue;
        const cost = Math.max(Number(row.building_construction_cost_customer || 0), Number(row.building_construction_cost_system || 0), inferredProjectValue(project));
        const address = String(row.project_address || 'Mecklenburg County');
        const fingerprint = opportunityFingerprint(`${address} ${scope}`, 'Charlotte / Lake Norman');
        if (known.fingerprints.has(fingerprint)) continue;
        await addLead({
            name: row.owner_name ? `${row.owner_name} - permit ${permit}` : `Mecklenburg permit ${permit}`,
            phone: String(row.owner_phone || ''),
            email: String(row.owner_email_address || ''),
            market: 'Charlotte / Lake Norman',
            project,
            source: 'Mecklenburg Permit Signal',
            value: cost,
            notes: `Public permit signal - review before outreach | Permit: ${permit} | Status: ${row.permit_status || 'unknown'} | Address: ${address} | Scope: ${scope.slice(0, 650)} | Owner city/state: ${[row.owner_city, row.owner_state, row.owner_zip_code].filter(Boolean).join(' ')} | Source: Mecklenburg County Accela permit data`,
            lead_id: externalId,
            nextAction: 'Review permit scope and owner context; contact only when outreach is appropriate and compliant'
        }, 'Mecklenburg Permit Signal');
        known.externalIds.add(externalId);
        known.fingerprints.add(fingerprint);
        added += 1;
        if (added >= 20) break;
    }
    return { added, scanned: rows.length };
}

async function scanRedditMarket(subreddit: string, market: string, source: string): Promise<{ added: number; scanned: number }> {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`;
    const response = await fetch(url, { headers: { 'User-Agent': 'ABWLeadEngineV10/2.0 public-intent-monitor' } });
    if (!response.ok) throw new Error(`${source} returned ${response.status}`);
    const listing = await response.json() as RedditListing;
    const children = listing.data?.children || [];
    const known = await recentLeadKeys();
    let added = 0;
    for (const child of children) {
        const post = child.data || {};
        const id = post.id || '';
        const externalId = `reddit:${subreddit}:${id}`;
        if (!id || known.externalIds.has(externalId)) continue;
        const text = `${post.title || ''}\n${post.selftext || ''}`.trim();
        const strength = intentStrength(text);
        if (strength < 35) continue;
        const ageHours = post.created_utc ? Math.max(0, (Date.now() / 1000 - post.created_utc) / 3600) : 999;
        if (ageHours > 504) continue;
        const fingerprint = opportunityFingerprint(text, market);
        if (known.fingerprints.has(fingerprint)) continue;
        const project = classifyProject(text);
        const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
        await addLead({
            name: post.author ? `Reddit opportunity - u/${post.author}` : 'Reddit project opportunity',
            market,
            project,
            source,
            value: inferredProjectValue(project),
            notes: `${post.title || 'Project request'}${post.selftext ? ` | ${post.selftext.slice(0, 700)}` : ''} | Intent score: ${strength}${ageHours < 999 ? ` | Age: ${Math.round(ageHours)}h` : ''}${permalink ? ` | Contact/post: ${permalink}` : ''}`,
            lead_id: externalId,
            nextAction: strength >= 65 ? 'Open source post and respond now if qualified' : 'Review source post and respond if qualified'
        }, source);
        known.externalIds.add(externalId);
        known.fingerprints.add(fingerprint);
        added += 1;
        if (added >= 20) break;
    }
    return { added, scanned: children.length };
}

async function scanNycDobFilings(): Promise<{ added: number; scanned: number }> {
    const url = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?$limit=100&$order=job_filing_number%20DESC';
    const response = await fetch(url, { headers: { 'User-Agent': 'ABWLeadEngineV10/2.1 public-project-signal-monitor' } });
    if (!response.ok) throw new Error(`NYC DOB returned ${response.status}`);
    const rows = await response.json() as NycJobFiling[];
    const known = await recentLeadKeys();
    let added = 0;
    for (const row of rows) {
        const filing = row.job_filing_number || '';
        if (!filing) continue;
        const externalId = `nycdob:${filing}`;
        if (known.externalIds.has(externalId)) continue;
        const description = `${row.job_description || ''} ${row.work_type || ''}`.trim();
        const project = classifyProject(description);
        if (!PUBLIC_KEYWORDS.some(keyword => description.toLowerCase().includes(keyword)) && project === 'General Remodeling') continue;
        const address = [row.house_no, row.street_name, row.borough].filter(Boolean).join(' ');
        const fingerprint = opportunityFingerprint(`${address} ${description}`, 'New York City');
        if (known.fingerprints.has(fingerprint)) continue;
        const statedCost = Number(String(row.initial_cost || '').replace(/[^0-9.]/g, '')) || 0;
        await addLead({
            name: row.owner_s_business_name || `NYC DOB project ${filing}`,
            market: 'New York City',
            project,
            source: 'NYC DOB Job Filing',
            value: Math.max(statedCost, inferredProjectValue(project)),
            notes: `Public permit/job-filing signal | Filing: ${filing} | Address: ${address || 'NYC'} | Status: ${row.filing_status || 'unknown'} | Scope: ${description.slice(0, 700)}${row.applicant_business_name ? ` | Applicant: ${row.applicant_business_name}` : ''}`,
            lead_id: externalId,
            nextAction: 'Research property/owner and qualify project before outreach'
        }, 'NYC DOB Job Filing');
        known.externalIds.add(externalId);
        known.fingerprints.add(fingerprint);
        added += 1;
        if (added >= 15) break;
    }
    return { added, scanned: rows.length };
}

async function scanCharlotteHousingBids(): Promise<{ added: number; scanned: number }> {
    const url = 'https://www.charlottenc.gov/Streets-and-Neighborhoods/Housing/Resources-for-Developers-and-Contractors/Contractor-Resources';
    const response = await fetch(url, { headers: { 'User-Agent': 'ABWLeadEngineV10/2.1 public-bid-monitor' } });
    if (!response.ok) throw new Error(`Charlotte Housing bids returned ${response.status}`);
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const matches = [...text.matchAll(/Bid Number:\s*([A-Z0-9 -]+).*?Type:\s*([^]*?)Street Name:\s*([^]*?)Bid walk time:\s*([^]*?)Bid close time:\s*([^]*?)(?=Bid Number:|$)/gi)].slice(0, 20);
    const known = await recentLeadKeys();
    let added = 0;
    for (const match of matches) {
        const bid = match[1].trim().slice(0, 40);
        const type = match[2].trim().slice(0, 80);
        const street = match[3].trim().slice(0, 120);
        const close = match[5].trim().slice(0, 120);
        const externalId = `charlotte-housing:${bid}`;
        if (!bid || known.externalIds.has(externalId)) continue;
        await addLead({
            name: `City of Charlotte Housing ${bid}`,
            market: 'Charlotte / Lake Norman',
            project: 'General Remodeling',
            source: 'Charlotte Housing Bid',
            value: 15000,
            notes: `Public rehabilitation bid | Bid: ${bid} | Type: ${type} | Property: ${street} | Bid close: ${close} | Source: City of Charlotte Housing Contractor Resources`,
            lead_id: externalId,
            nextAction: 'Open bid packet, verify eligibility and deadline, then prepare bid'
        }, 'Charlotte Housing Bid');
        known.externalIds.add(externalId);
        added += 1;
    }
    return { added, scanned: matches.length };
}

const GOVERNMENT_NAICS = new Set(['236115', '236116', '236117', '236118', '236220', '237110', '237310', '238110', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990']);
const GOVERNMENT_STATES = ['NC', 'VA', 'NY', 'NJ'];

function samDate(date: Date): string {
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function samMarket(opportunity: SamOpportunity, fallbackState: string): string {
    const place = opportunity.placeOfPerformance;
    return [place?.city?.name, place?.state?.code || fallbackState, place?.zip].filter(Boolean).join(', ') || fallbackState;
}

function isRelevantGovernmentOpportunity(opportunity: SamOpportunity): boolean {
    if ((opportunity.active || '').toLowerCase() === 'no') return false;
    if (opportunity.responseDeadLine && Date.parse(opportunity.responseDeadLine) < Date.now()) return false;
    const text = `${opportunity.title || ''} ${opportunity.fullParentPathName || ''}`.toLowerCase();
    const naicsMatch = Boolean(opportunity.naicsCode && GOVERNMENT_NAICS.has(opportunity.naicsCode));
    const keywordMatch = ['construction', 'renovation', 'remodel', 'repair', 'rehab', 'electrical', 'roof', 'floor', 'paint', 'drywall', 'plumbing', 'hvac', 'fence', 'facility', 'building', 'kitchen', 'bathroom'].some(term => text.includes(term));
    return naicsMatch || keywordMatch;
}

async function scanSamGovernmentOpportunities(): Promise<{ added: number; scanned: number; configured: boolean }> {
    const names = await secrets.listSecretNames();
    if (!names.includes('SAM_GOV_API_KEY')) return { added: 0, scanned: 0, configured: false };
    const apiKey = await secrets.readSecret('SAM_GOV_API_KEY');
    const postedTo = new Date();
    const postedFrom = new Date(Date.now() - 21 * 86400000);
    const known = await recentLeadKeys();
    let added = 0;
    let scanned = 0;
    for (const state of GOVERNMENT_STATES) {
        const params = new URLSearchParams({ api_key: apiKey, postedFrom: samDate(postedFrom), postedTo: samDate(postedTo), state, limit: '100', offset: '0' });
        const response = await fetch(`https://api.sam.gov/opportunities/v2/search?${params.toString()}`, { headers: { 'User-Agent': 'ABWLeadEngineV10/3.0 government-opportunity-monitor' } });
        if (!response.ok) throw new Error(`SAM.gov ${state} returned ${response.status}`);
        const payload = await response.json() as SamOpportunityResponse;
        const opportunities = payload.opportunitiesData || [];
        scanned += opportunities.length;
        for (const opportunity of opportunities) {
            const noticeId = opportunity.noticeId || '';
            const externalId = noticeId ? `sam:${noticeId}` : '';
            if (!noticeId || known.externalIds.has(externalId) || !isRelevantGovernmentOpportunity(opportunity)) continue;
            const market = samMarket(opportunity, state);
            const title = opportunity.title || `SAM.gov opportunity ${opportunity.solicitationNumber || noticeId}`;
            const project = classifyProject(title);
            const fingerprint = opportunityFingerprint(`${title} ${opportunity.solicitationNumber || ''}`, market);
            if (known.fingerprints.has(fingerprint)) continue;
            const poc = (opportunity.pointOfContact || []).find(item => item.email || item.phone) || {};
            const setAside = opportunity.typeOfSetAsideDescription || opportunity.typeOfSetAside || 'Not specified';
            const noticeType = opportunity.type || opportunity.baseType || 'Opportunity';
            const sourceUrl = `https://sam.gov/opp/${noticeId}/view`;
            const priority = /small business|sources sought/i.test(`${setAside} ${noticeType}`) ? 'HIGH PRIORITY' : 'REVIEW';
            await addLead({
                name: title,
                phone: poc.phone || '',
                email: poc.email || '',
                market,
                project,
                source: 'SAM.gov Government Opportunity',
                value: inferredProjectValue(project),
                notes: `${priority} federal opportunity | Solicitation: ${opportunity.solicitationNumber || 'not listed'} | Notice type: ${noticeType} | Set-aside: ${setAside} | NAICS: ${opportunity.naicsCode || 'not listed'} | Posted: ${opportunity.postedDate || 'unknown'} | Response deadline: ${opportunity.responseDeadLine || 'not listed'}${poc.fullName ? ` | POC: ${poc.fullName}` : ''} | Source: ${sourceUrl}`,
                lead_id: externalId,
                nextAction: /sources sought/i.test(noticeType) ? 'Review Sources Sought and prepare capability response' : 'Open SAM notice, verify eligibility and prepare bid/no-bid decision'
            }, 'SAM.gov Government Opportunity');
            known.externalIds.add(externalId);
            known.fingerprints.add(fingerprint);
            added += 1;
            if (added >= 30) break;
        }
        if (added >= 30) break;
    }
    return { added, scanned, configured: true };
}

const PROCUREMENT_ADVANTAGE_SOURCES = [
    { name: 'NC eVP', market: 'North Carolina', url: 'https://evp.nc.gov/', strategy: 'State solicitations + NCSBE vendor positioning', priority: 92 },
    { name: 'Virginia eVA / SWaM', market: 'Virginia', url: 'https://eva.virginia.gov/', strategy: 'State/local construction + SWaM prime/subcontract lane', priority: 95 },
    { name: 'SBA SUBNet', market: 'Federal', url: 'https://www.sba.gov/subnet', strategy: 'Subcontract directly under federal prime contractors', priority: 90 },
    { name: 'SBA Prime Contractor Directory', market: 'Federal', url: 'https://www.sba.gov/document/support-directory-federal-government-prime-contractors-subcontracting-plans', strategy: 'Identify primes required to pursue small-business subcontracting goals', priority: 94 },
    { name: 'USAspending Award Intelligence', market: 'NC / VA / NY / NJ', url: 'https://www.usaspending.gov/', strategy: 'Reverse-map incumbent winners and recurring agency buyers before the next solicitation', priority: 88 }
];

function procurementAdvantageScore(source: typeof PROCUREMENT_ADVANTAGE_SOURCES[number]): number {
    const marketBoost = /Virginia|North Carolina/.test(source.market) ? 5 : 0;
    const subcontractBoost = /subcontract|prime/i.test(source.strategy) ? 4 : 0;
    return Math.min(100, source.priority + marketBoost + subcontractBoost);
}

async function procurementAdvantageSnapshot() {
    return PROCUREMENT_ADVANTAGE_SOURCES.map(source => ({ ...source, score: procurementAdvantageScore(source), action: source.name.includes('Prime') || source.name.includes('USAspending') ? 'Mine incumbent/prime relationships and pursue subcontract access' : 'Monitor qualifying opportunities and registration/certification readiness' })).sort((a, b) => b.score - a.score);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function defaultGenome(): StrategyGenome {
    const now = new Date().toISOString();
    return { generation: 1, createdAt: now, updatedAt: now, explorationMultiplier: 1, staleLeadBoost: 8, valuePriorityCap: 150, followUpHours: 24, marketWeights: { Charlotte: 1.2, Virginia: 1.2, NYC: 1, Federal: 1, Other: 0.9 }, fitness: 0, baselineFitness: 0, parentGeneration: 0, status: 'active', lastReason: 'Initial bounded strategy genome' };
}

async function strategyGenomes(): Promise<Array<StrategyGenome & { id: string }>> {
    const { items } = await db.list<StrategyGenome>('strategy_genomes', { limit: 20 });
    return items.slice().sort((a, b) => b.generation - a.generation);
}

async function activeGenome(): Promise<StrategyGenome & { id?: string }> {
    const genomes = await strategyGenomes();
    return genomes.find(item => item.status === 'active') || genomes[0] || defaultGenome();
}

function marketBucket(lead: Lead): string {
    const text = `${lead.market} ${lead.source}`.toLowerCase();
    if (text.includes('charlotte') || text.includes('lake norman') || text.includes('north carolina') || text.includes('mecklenburg')) return 'Charlotte';
    if (text.includes('virginia') || text.includes('hampton') || text.includes('norfolk')) return 'Virginia';
    if (text.includes('new york') || text.includes('nyc')) return 'NYC';
    if (text.includes('sam.gov') || text.includes('federal')) return 'Federal';
    return 'Other';
}

function strategyPriority(lead: Lead, genome: StrategyGenome): number {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = Boolean(lead.nextActionDue && lead.nextActionDue < today && !TERMINAL_STATUSES.has(lead.status));
    const staleDays = Math.max(0, Math.floor((Date.now() - Date.parse(lead.lastTouch || lead.createdAt || new Date().toISOString())) / 86400000));
    const expectedValue = (lead.estimatedValue || 0) * stageProbability(lead.status);
    const marketWeight = genome.marketWeights[marketBucket(lead)] || 1;
    return Math.round((conversionPriority(lead) + (overdue ? 200 : 0) + Math.min(staleDays * genome.staleLeadBoost, 180) + Math.min(Math.floor(expectedValue / 1000), genome.valuePriorityCap)) * marketWeight);
}

function fitnessFor(leads: Lead[], sources: SourceIntelligence[]): number {
    const real = leads.filter(lead => !lead.source.toLowerCase().includes('test'));
    const active = real.filter(lead => !TERMINAL_STATUSES.has(lead.status));
    const cash = real.filter(lead => lead.status === 'Cash Collected').reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const weighted = active.reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    const wins = real.filter(lead => lead.status === 'Won/Active' || lead.status === 'Cash Collected').length;
    const qualified = active.filter(lead => ['Qualified', 'Estimate/Bid', 'Deposit Due', 'Won/Active'].includes(lead.status)).length;
    const overdue = active.filter(lead => lead.nextActionDue && lead.nextActionDue < new Date().toISOString().slice(0, 10)).length;
    const sourceAdds = sources.reduce((sum, source) => sum + source.added, 0);
    const failures = sources.reduce((sum, source) => sum + source.failures, 0);
    return Math.round(weighted / 1000 + cash / 500 + wins * 50 + qualified * 12 + sourceAdds * 2 - overdue * 8 - failures * 2);
}

function boundedMarketWeights(leads: Lead[], current: StrategyGenome): Record<string, number> {
    const scores: Record<string, number> = { Charlotte: 1, Virginia: 1, NYC: 1, Federal: 1, Other: 1 };
    for (const lead of leads) {
        if (lead.source.toLowerCase().includes('test')) continue;
        scores[marketBucket(lead)] += stageProbability(lead.status) * Math.max(1, (lead.estimatedValue || 0) / 5000);
    }
    const maxScore = Math.max(...Object.values(scores));
    const result: Record<string, number> = {};
    for (const key of Object.keys(scores)) {
        const target = 0.85 + 0.65 * (scores[key] / maxScore);
        result[key] = Number(clamp((current.marketWeights[key] || 1) * 0.8 + target * 0.2, 0.75, 1.5).toFixed(2));
    }
    return result;
}

async function strategyEvolutionSweep(force = false): Promise<{ genome: StrategyGenome; action: string; skipped?: boolean }> {
    const [genomes, leadPage, sourcePage] = await Promise.all([strategyGenomes(), db.list<Lead>('leads', { limit: 100 }), db.list<SourceIntelligence>('source_intelligence', { limit: 50 })]);
    const current = genomes.find(item => item.status === 'active') || genomes[0];
    if (current && !force && Date.now() - Date.parse(current.updatedAt) < 4 * 3600000) return { genome: current, action: 'cooldown', skipped: true };
    const leads = leadPage.items;
    const sources = sourcePage.items;
    const fitness = fitnessFor(leads, sources);
    if (!current) {
        const genome = { ...defaultGenome(), fitness, baselineFitness: fitness };
        await db.add('strategy_genomes', [genome]);
        await db.add('evolution_history', [{ createdAt: genome.updatedAt, generation: genome.generation, priorGeneration: 0, fitness, action: 'initialized', summary: 'Initialized self-improvement strategy genome from live business state.', aiHypothesis: '', genome }]);
        return { genome, action: 'initialized' };
    }
    if (current.baselineFitness > 25 && fitness < current.baselineFitness * 0.82) {
        const prior = genomes.find(item => item.generation === current.parentGeneration);
        if (prior && current.id && prior.id) {
            const now = new Date().toISOString();
            const rolledCurrent: StrategyGenome = { ...current, status: 'rolled-back', updatedAt: now, fitness, lastReason: 'Automatic rollback: fitness fell more than 18% below baseline.' };
            const restored: StrategyGenome = { ...prior, status: 'active', updatedAt: now, lastReason: `Restored after generation ${current.generation} underperformed.` };
            await db.update('strategy_genomes', [{ id: current.id, record: rolledCurrent }, { id: prior.id, record: restored }]);
            await db.add('evolution_history', [{ createdAt: now, generation: restored.generation, priorGeneration: current.generation, fitness, action: 'rolled-back', summary: rolledCurrent.lastReason, aiHypothesis: '', genome: restored }]);
            return { genome: restored, action: 'rolled-back' };
        }
    }
    const now = new Date().toISOString();
    const totalScanned = sources.reduce((sum, source) => sum + source.scanned, 0);
    const totalAdded = sources.reduce((sum, source) => sum + source.added, 0);
    const yieldRate = totalAdded / Math.max(1, totalScanned);
    const overdue = leads.filter(lead => !TERMINAL_STATUSES.has(lead.status) && lead.nextActionDue && lead.nextActionDue < now.slice(0, 10)).length;
    const next: StrategyGenome = {
        ...current,
        generation: current.generation + 1,
        parentGeneration: current.generation,
        createdAt: now,
        updatedAt: now,
        explorationMultiplier: Number(clamp(current.explorationMultiplier + (yieldRate < 0.01 ? 0.08 : yieldRate > 0.06 ? -0.04 : 0), 0.6, 1.6).toFixed(2)),
        staleLeadBoost: clamp(current.staleLeadBoost + (overdue > 8 ? 2 : overdue < 3 ? -1 : 0), 4, 16),
        valuePriorityCap: clamp(current.valuePriorityCap + (fitness >= current.fitness ? 10 : -10), 80, 220),
        followUpHours: clamp(current.followUpHours + (overdue > 8 ? -6 : overdue < 3 ? 3 : 0), 6, 48),
        marketWeights: boundedMarketWeights(leads, current),
        fitness,
        baselineFitness: fitness,
        status: 'active',
        lastReason: `Bounded evolution from generation ${current.generation}; yield ${(yieldRate * 100).toFixed(2)}%, overdue ${overdue}.`
    };
    if (current.id) await db.update('strategy_genomes', [{ id: current.id, record: { ...current, status: 'archived', updatedAt: now } }]);
    await db.add('strategy_genomes', [next]);
    await db.add('evolution_history', [{ createdAt: now, generation: next.generation, priorGeneration: current.generation, fitness, action: 'evolved', summary: next.lastReason, aiHypothesis: '', genome: next }]);
    return { genome: next, action: 'evolved' };
}

async function softwareUpgradePipeline() {
    const [{ items: leads }, { items: sources }, { items: history }, { items: existing }] = await Promise.all([db.list<Lead>('leads', { limit: 100 }), db.list<SourceIntelligence>('source_intelligence', { limit: 50 }), db.list<EvolutionRecord>('evolution_history', { limit: 20 }), db.list<SoftwareUpgrade>('software_upgrades', { limit: 30 })]);
    const recent = existing.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (recent && Date.now() - Date.parse(recent.createdAt) < 20 * 3600000) return { generated: 0 };
    const genome = await activeGenome();
    const command = await buildCommandCenter();
    const sourceSummary = sources.slice().sort((a, b) => b.posteriorMean - a.posteriorMean).slice(0, 8).map(source => `${source.label}: ${(source.posteriorMean * 100).toFixed(1)}% yield`).join('; ');
    const result = await ai.generate({ system: 'You are the software-evolution architect for a lawful contractor revenue operating system. Generate improvements from evidence, not hype. Low-risk reversible configuration, ranking, timing, diagnostics and workflow changes may be auto-safe. Any change involving money movement, legal commitments, credentials, secrets, identity, destructive actions, customer promises, unrestricted outbound messaging, security boundaries, or production code execution must be gated. Return strict JSON only.', prompt: `Create exactly 3 upgrade proposals from this live state. Genome=${JSON.stringify(genome)} Command=${JSON.stringify(command)} Sources=${sourceSummary} Leads=${leads.length} PriorHistory=${history.slice(0,5).map(item => item.summary).join(' | ')}. JSON shape: {"upgrades":[{"title":"","hypothesis":"","category":"revenue|reliability|automation|acquisition|conversion","risk":"low|medium|high","autonomy":"auto-safe|gated","expectedImpact":1,"confidence":0.5,"successMetric":"","rollbackTrigger":"","evidence":""}]}. expectedImpact is 1-100 and confidence 0-1.`, schema: { type: 'object', properties: { upgrades: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, hypothesis: { type: 'string' }, category: { type: 'string' }, risk: { type: 'string' }, autonomy: { type: 'string' }, expectedImpact: { type: 'number' }, confidence: { type: 'number' }, successMetric: { type: 'string' }, rollbackTrigger: { type: 'string' }, evidence: { type: 'string' } }, required: ['title','hypothesis','category','risk','autonomy','expectedImpact','confidence','successMetric','rollbackTrigger','evidence'] } } }, required: ['upgrades'] }, thinkingMode: 'DEEP', maxTokens: 1200, temperature: 0.2 });
    let parsed: { upgrades?: Array<Record<string, unknown>> } = {};
    try { parsed = JSON.parse(result.text) as { upgrades?: Array<Record<string, unknown>> }; } catch { console.warn('Software evolution JSON parse failed'); }
    const upgrades: SoftwareUpgrade[] = (parsed.upgrades || []).slice(0, 3).map(item => { const risk = ['low','medium','high'].includes(String(item.risk)) ? String(item.risk) as SoftwareUpgrade['risk'] : 'medium'; const requestedAutonomy = String(item.autonomy); const autonomy: SoftwareUpgrade['autonomy'] = risk === 'low' && requestedAutonomy === 'auto-safe' ? 'auto-safe' : 'gated'; const impact = clamp(Number(item.expectedImpact) || 1, 1, 100); const confidence = clamp(Number(item.confidence) || 0.1, 0.05, 0.99); return { createdAt: new Date().toISOString(), title: String(item.title || 'Untitled improvement').slice(0, 160), hypothesis: String(item.hypothesis || '').slice(0, 1500), category: ['revenue','reliability','automation','acquisition','conversion'].includes(String(item.category)) ? String(item.category) as SoftwareUpgrade['category'] : 'automation', risk, autonomy, expectedImpact: impact, confidence, priority: Math.round(impact * confidence), status: autonomy === 'auto-safe' ? 'approved' : 'proposed', successMetric: String(item.successMetric || '').slice(0, 600), rollbackTrigger: String(item.rollbackTrigger || '').slice(0, 600), evidence: String(item.evidence || '').slice(0, 1000) }; });
    if (upgrades.length) await db.add('software_upgrades', upgrades);
    return { generated: upgrades.length };
}

function canaryGenome(current: StrategyGenome, upgrade: SoftwareUpgrade): StrategyGenome {
    const now = new Date().toISOString();
    const next: StrategyGenome = { ...current, generation: current.generation + 1, parentGeneration: current.generation, createdAt: now, updatedAt: now, status: 'active', baselineFitness: current.fitness, lastReason: `Closed-loop canary for ${upgrade.title}` };
    if (upgrade.category === 'acquisition') next.explorationMultiplier = Number(clamp(current.explorationMultiplier + 0.05, 0.6, 1.6).toFixed(2));
    if (upgrade.category === 'conversion') next.followUpHours = clamp(current.followUpHours - 3, 6, 48);
    if (upgrade.category === 'reliability') next.explorationMultiplier = Number(clamp(current.explorationMultiplier - 0.03, 0.6, 1.6).toFixed(2));
    if (upgrade.category === 'automation') next.staleLeadBoost = clamp(current.staleLeadBoost + 1, 4, 16);
    if (upgrade.category === 'revenue') next.valuePriorityCap = clamp(current.valuePriorityCap + 10, 80, 220);
    return next;
}

async function releasePipelineFor(upgradeId: string): Promise<ReleaseRun> {
    const [upgrade] = await db.get<SoftwareUpgrade>('software_upgrades', [upgradeId]);
    if (!upgrade) throw new Error('Upgrade proposal not found');
    if (upgrade.status !== 'approved') throw new Error('Upgrade must be approved before release testing');
    const genome = await activeGenome();
    const command = await buildCommandCenter();
    const result = await ai.generate({
        system: 'Create a safe implementation package for a contractor business operating system. Do not include secrets, credentials, shell commands, destructive operations, payment movement, identity changes, legal commitments, spam, or bypasses. Return strict JSON only.',
        prompt: `Upgrade=${JSON.stringify(upgrade)}. BaselineGenome=${JSON.stringify(genome)}. CommandCenter=${JSON.stringify(command)}. Produce a minimal implementation package. JSON shape: {"allowedFiles":["backend/index.ts"],"changeSummary":"","candidateDiff":"","tests":[""],"canaryMetric":"","rollbackPlan":""}. candidateDiff is a human-readable patch specification, not executable shell code.`,
        schema: { type: 'object', properties: { allowedFiles: { type: 'array', items: { type: 'string' } }, changeSummary: { type: 'string' }, candidateDiff: { type: 'string' }, tests: { type: 'array', items: { type: 'string' } }, canaryMetric: { type: 'string' }, rollbackPlan: { type: 'string' } }, required: ['allowedFiles','changeSummary','candidateDiff','tests','canaryMetric','rollbackPlan'] },
        thinkingMode: 'DEEP', maxTokens: 1400, temperature: 0.15
    });
    let pkg: { allowedFiles?: string[]; changeSummary?: string; candidateDiff?: string; tests?: string[]; canaryMetric?: string; rollbackPlan?: string } = {};
    try { pkg = JSON.parse(result.text) as typeof pkg; } catch { pkg = { changeSummary: 'AI package parse failed; manual regeneration required.', candidateDiff: '', tests: [], canaryMetric: upgrade.successMetric, rollbackPlan: upgrade.rollbackTrigger }; }
    const packageText = `${pkg.changeSummary || ''}\n${pkg.candidateDiff || ''}`.slice(0, 9000);
    const forbidden = ['password','api key','secret value','credential','shell command','exec(','eval(','rm -','delete database','move money','charge card','send unrestricted','impersonate','bypass'];
    const hits = forbidden.filter(term => packageText.toLowerCase().includes(term));
    const staticPassed = hits.length === 0;
    const baselineFitness = genome.fitness;
    const candidateScore = Math.round(baselineFitness + upgrade.expectedImpact * upgrade.confidence - (upgrade.risk === 'high' ? 30 : upgrade.risk === 'medium' ? 12 : 3));
    const now = new Date().toISOString();
    let stage: ReleaseRun['stage'] = 'isolated-test';
    let promotedGenome: StrategyGenome | undefined;
    let policyNotes = staticPassed ? 'Static policy gate passed.' : `Static policy gate rejected terms: ${hits.join(', ')}`;
    if (!staticPassed) stage = 'rejected-policy';
    else if (upgrade.autonomy === 'gated') { stage = 'deployment-ready'; policyNotes += ' Code-changing or consequential release remains gated for external platform validation.'; }
    else if (candidateScore >= baselineFitness) {
        const next = canaryGenome(genome, upgrade);
        const genomes = await strategyGenomes();
        const current = genomes.find(item => item.status === 'active');
        if (current?.id) await db.update('strategy_genomes', [{ id: current.id, record: { ...current, status: 'archived', updatedAt: now } }]);
        await db.add('strategy_genomes', [next]);
        promotedGenome = next;
        stage = 'promoted';
        policyNotes += ` Shadow score ${candidateScore} met baseline ${baselineFitness}; bounded canary promoted with rollback snapshot retained.`;
    } else {
        stage = 'rolled-back';
        policyNotes += ` Shadow score ${candidateScore} missed baseline ${baselineFitness}; no production strategy mutation was applied.`;
    }
    const run: ReleaseRun = { upgradeId, title: upgrade.title, createdAt: now, updatedAt: now, stage, autonomy: upgrade.autonomy, baselineFitness, candidateScore, staticPassed, policyNotes, patchPackage: packageText, tests: (pkg.tests || []).slice(0, 8).map(value => String(value).slice(0, 500)), canaryMetric: String(pkg.canaryMetric || upgrade.successMetric).slice(0, 700), rollbackPlan: String(pkg.rollbackPlan || upgrade.rollbackTrigger).slice(0, 700), rollbackGenome: genome, promotedGenome };
    await db.add('release_runs', [run]);
    return run;
}

async function autoRunApprovedSafeUpgrades() {
    const [{ items: upgrades }, { items: runs }] = await Promise.all([db.list<SoftwareUpgrade>('software_upgrades', { limit: 30 }), db.list<ReleaseRun>('release_runs', { limit: 30 })]);
    const completed = new Set(runs.map(run => run.upgradeId));
    const candidate = upgrades.filter(item => item.status === 'approved' && item.autonomy === 'auto-safe' && !completed.has(item.id)).sort((a, b) => b.priority - a.priority)[0];
    if (candidate) await releasePipelineFor(candidate.id);
}

export const innovationSweep = async () => {
    const [{ items: leads }, { items: sources }, { items: history }] = await Promise.all([db.list<Lead>('leads', { limit: 100 }), db.list<SourceIntelligence>('source_intelligence', { limit: 50 }), db.list<EvolutionRecord>('evolution_history', { limit: 20 })]);
    const lastInnovation = history.filter(item => item.action === 'innovation').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (lastInnovation && Date.now() - Date.parse(lastInnovation.createdAt) < 20 * 3600000) return { statusCode: 200 };
    const genome = await activeGenome();
    const command = await buildCommandCenter();
    const sourceSummary = sources.slice().sort((a, b) => b.posteriorMean - a.posteriorMean).slice(0, 8).map(source => `${source.label}: ${(source.posteriorMean * 100).toFixed(1)}% learned yield, ${source.added}/${source.scanned}`).join('; ');
    const result = await ai.generate({
        system: 'You are an operations-research strategist for a lawful home-improvement company. Never recommend bypassing access controls, scraping prohibited private data, deceptive identities, licensing evasion, spam, or unauthorized contact. Focus on measurable revenue, lead quality, procurement access, conversion speed, margin, and owner time.',
        prompt: `Review this V10 state and propose exactly 3 high-impact upgrades. Separate runtime/config ideas from code/integration ideas. Current genome: ${JSON.stringify(genome)}. Command center: ${JSON.stringify(command)}. Best source evidence: ${sourceSummary}. Lead count: ${leads.length}. Keep it under 450 words and make each proposal measurable.`,
        thinkingMode: 'FAST',
        maxTokens: 650,
        temperature: 0.25
    });
    const record: EvolutionRecord = { createdAt: new Date().toISOString(), generation: genome.generation, priorGeneration: genome.parentGeneration, fitness: genome.fitness, action: 'innovation', summary: 'Daily AI innovation review generated from live business telemetry; code-level changes remain gated until validated.', aiHypothesis: result.text.slice(0, 5000), genome };
    await db.add('evolution_history', [record]);
    await softwareUpgradePipeline();
    await autoRunApprovedSafeUpgrades();
    return { statusCode: 200 };
};

async function scanPublicMarkets() {
    const sources = [
        { subreddit: 'Charlotte', market: 'Charlotte / Lake Norman', source: 'Public Reddit - Charlotte' },
        { subreddit: 'LakeNorman', market: 'Charlotte / Lake Norman', source: 'Public Reddit - Lake Norman' },
        { subreddit: 'NorthCarolina', market: 'Charlotte / Lake Norman', source: 'Public Reddit - North Carolina' },
        { subreddit: 'VirginiaBeach', market: 'Hampton Roads / Virginia Beach', source: 'Public Reddit - Virginia Beach' },
        { subreddit: 'HamptonRoads', market: 'Hampton Roads / Virginia Beach', source: 'Public Reddit - Hampton Roads' },
        { subreddit: 'norfolk', market: 'Hampton Roads / Virginia Beach', source: 'Public Reddit - Norfolk' },
        { subreddit: 'nyc', market: 'New York City', source: 'Public Reddit - NYC' },
        { subreddit: 'AskNYC', market: 'New York City', source: 'Public Reddit - AskNYC' },
        { subreddit: 'NYCRenovations', market: 'New York City', source: 'Public Reddit - NYC Renovations' }
    ];
    const results: Array<Record<string, unknown> & { added: number; scanned: number }> = [];
    for (const item of sources) {
        try {
            const sourceId = `reddit:${item.subreddit.toLowerCase()}`;
            results.push({ ...item, ...(await runAdaptiveSource(sourceId, item.source, item.market, () => scanRedditMarket(item.subreddit, item.market, item.source))) });
        } catch (err) {
            console.warn(`${item.source} scan failed`, err);
            results.push({ ...item, added: 0, scanned: 0 });
        }
    }
    for (const collector of [
        { id: 'nyc-dob', source: 'NYC DOB Job Filings', market: 'New York City', run: scanNycDobFilings },
        { id: 'charlotte-housing', source: 'Charlotte Housing Bids', market: 'Charlotte / Lake Norman', run: scanCharlotteHousingBids },
        { id: 'mecklenburg-permits', source: 'Mecklenburg Permit Signals', market: 'Charlotte / Lake Norman', run: scanMecklenburgPermitSignals },
        { id: 'sam-government', source: 'SAM.gov Government Opportunities', market: 'NC / VA / NY / NJ', run: scanSamGovernmentOpportunities }
    ]) {
        try {
            results.push({ source: collector.source, market: collector.market, ...(await runAdaptiveSource(collector.id, collector.source, collector.market, collector.run)) });
        } catch (err) {
            console.warn(`${collector.source} scan failed`, err);
            results.push({ source: collector.source, market: collector.market, added: 0, scanned: 0 });
        }
    }
    return {
        added: results.reduce((sum, item) => sum + item.added, 0),
        scanned: results.reduce((sum, item) => sum + item.scanned, 0),
        results
    };
}

export const publicOpportunityScan = async () => {
    await scanPublicMarkets();
    return { statusCode: 200 };
};

function scoreLead(input: IncomingLead): number {
    let score = 20;
    const text = `${input.project || input.request?.category || ''} ${input.notes || input.request?.description || ''}`.toLowerCase();
    if (input.phone || input.request?.phone) score += 15;
    if (input.email || input.request?.email) score += 10;
    if (input.project || input.request?.category) score += 15;
    if (Number(input.value || 0) >= 5000) score += 20;
    const intent = intentStrength(text);
    if (intent >= 35) score += 10;
    if (intent >= 65) score += 10;
    if (['addition', 'kitchen', 'bathroom', 'electrical', 'renovation', 'remodel', 'garage conversion', 'full rehab', 'whole home', 'structural', 'roof', 'water damage'].some(term => text.includes(term))) score += 10;
    if (['asap', 'urgent', 'within the next', 'this week', 'this month', 'soon'].some(term => text.includes(term))) score += 10;
    return Math.min(score, 100);
}

function normalize(input: IncomingLead, source = 'Manual'): Lead {
    const now = new Date().toISOString();
    const defaultDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const resolvedSource = input.source || source;
    return {
        name: input.name || input.request?.name || 'Unknown Lead',
        phone: input.phone || input.request?.phone || '',
        email: input.email || input.request?.email || '',
        market: input.market || input.request?.location || 'Other',
        project: input.project || input.request?.category || 'General Remodeling',
        source: resolvedSource,
        notes: input.notes || input.request?.description || '',
        status: 'New Lead',
        score: scoreLead(input),
        createdAt: now,
        externalId: input.lead_id || '',
        estimatedValue: Math.max(0, Number(input.value || 0)),
        nextAction: input.nextAction || (resolvedSource.startsWith('Public Reddit') ? 'Review source post and respond if qualified' : 'Contact and qualify opportunity'),
        nextActionDue: input.nextActionDue || defaultDue,
        lastTouch: now,
        statusUpdatedAt: now
    };
}

async function addLead(input: IncomingLead, source?: string) {
    const lead = normalize(input, source);
    const [id] = await db.add('leads', [lead]);
    if (!id) throw new Error('Failed to save lead');
    return { id, ...lead };
}

function collectBatchStrings(value: unknown, keyHint = '', output: Array<{ key: string; value: string }> = []): Array<{ key: string; value: string }> {
    if (typeof value === 'string') output.push({ key: keyHint.toLowerCase(), value });
    else if (Array.isArray(value)) value.forEach(item => collectBatchStrings(item, keyHint, output));
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([key, child]) => collectBatchStrings(child, key, output));
    return output;
}

function parseBatchContact(raw: unknown): BatchContact {
    const values = collectBatchStrings(raw);
    const phoneEntry = values.find(item => /phone|mobile|wireless|number/.test(item.key) && /^\\+?1?[-. ()]*\\d{3}[-. ()]*\\d{3}[-. ()]*\\d{4}$/.test(item.value.trim()));
    const emailEntry = values.find(item => /email/.test(item.key) && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(item.value.trim()));
    const flags = values.map(item => `${item.key}:${item.value}`.toLowerCase()).join('|');
    return { phone: phoneEntry?.value.trim() || '', email: emailEntry?.value.trim() || '', dnc: /dnc:true|donotcall:true|do_not_call:true|dnc:yes/.test(flags), tcpaRisk: /litigator:true|tcpa:true|tcpa_risk:true|litigator:yes/.test(flags) };
}

async function batchSkipTrace(address: string, city: string, state: string, zip: string, ownerName = ''): Promise<BatchContact | null> {
    const names = await secrets.listSecretNames();
    if (!names.includes('BATCHDATA_API_TOKEN')) return null;
    const token = await secrets.readSecret('BATCHDATA_API_TOKEN');
    const parts = ownerName.trim().split(/\\s+/);
    const payload: Record<string, unknown> = { propertyAddress: { street: address, city, state, zip } };
    if (parts.length) payload.name = { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
    const response = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [payload] }) });
    if (!response.ok) { console.warn(`BatchData skip trace returned ${response.status}`); return null; }
    return parseBatchContact(await response.json());
}

async function enrichPropertySignalLead(leadId: string, lead: Lead): Promise<boolean> {
    if (lead.phone || lead.email || lead.enrichmentStatus === 'matched') return false;
    if (!/permit|dob job filing|property/i.test(`${lead.source} ${lead.notes}`)) return false;
    const address = lead.notes.match(/Address:\\s*([^|]+)/i)?.[1]?.trim() || lead.notes.match(/Property:\\s*([^|]+)/i)?.[1]?.trim() || '';
    if (!address) return false;
    const market = lead.market.toLowerCase();
    const state = market.includes('new york') ? 'NY' : market.includes('virginia') ? 'VA' : market.includes('north carolina') || market.includes('charlotte') ? 'NC' : '';
    const city = market.includes('charlotte') ? 'Charlotte' : market.includes('new york') ? 'New York' : market.includes('virginia beach') ? 'Virginia Beach' : '';
    const zip = lead.notes.match(/\\b\\d{5}(?:-\\d{4})?\\b/)?.[0] || '';
    if (!state || !city) return false;
    const ownerName = lead.name.replace(/\\s*-\\s*permit.*$/i, '').replace(/^NYC DOB project.*$/i, '').trim();
    const contact = await batchSkipTrace(address, city, state, zip, ownerName);
    const now = new Date().toISOString();
    if (!contact) {
        await db.update('leads', [{ id: leadId, record: { ...lead, enrichmentProvider: 'BatchData', enrichmentStatus: 'no-match', enrichmentUpdatedAt: now, complianceReviewRequired: true } }]);
        return false;
    }
    const record: Lead = { ...lead, phone: contact.dnc || contact.tcpaRisk ? '' : contact.phone, email: contact.email, enrichmentProvider: 'BatchData', enrichmentStatus: contact.phone || contact.email ? 'matched' : 'no-match', enrichmentUpdatedAt: now, complianceReviewRequired: true, notes: `${lead.notes} | BatchData enrichment: ${contact.phone || contact.email ? 'contact matched' : 'no contact match'}${contact.dnc ? ' | DNC flag present' : ''}${contact.tcpaRisk ? ' | TCPA/litigator risk flag present' : ''}` };
    await db.update('leads', [{ id: leadId, record }]);
    return Boolean(record.phone || record.email);
}

async function batchEnrichmentSweep(force = false): Promise<number> {
    const { items } = await db.list<Lead>('leads', { limit: 100 });
    let matched = 0;
    let attempted = 0;
    for (const lead of items.slice().sort((a, b) => revenuePriority(b) - revenuePriority(a))) {
        if (attempted >= 8) break;
        if (lead.phone || lead.email || lead.enrichmentStatus === 'matched') continue;
        if (!/permit|dob job filing|property/i.test(`${lead.source} ${lead.notes}`)) continue;
        if (!force && lead.enrichmentStatus === 'no-match' && lead.enrichmentUpdatedAt && Date.now() - Date.parse(lead.enrichmentUpdatedAt) < 24 * 3600000) continue;
        attempted += 1;
        if (await enrichPropertySignalLead(lead.id, lead)) matched += 1;
    }
    return matched;
}

function sourceUrlFromNotes(notes: string): string {
    const match = notes.match(/https?:\/\/[^\s|]+/i);
    return match?.[0] || '';
}

function brandForMarket(market: string): string {
    const value = market.toLowerCase();
    return value.includes('charlotte') || value.includes('lake norman') || value.includes('north carolina') ? 'NC Custom Remodels LLC' : 'ABW Custom Remodels';
}

function outreachCopy(lead: Lead): { subject: string; text: string } {
    const brand = brandForMarket(lead.market);
    const firstName = lead.name.split(/[\s-]/).find(part => part && !['reddit', 'opportunity'].includes(part.toLowerCase())) || 'there';
    return {
        subject: `${lead.project} estimate - ${brand}`,
        text: `Hi ${firstName}, this is Anthony with ${brand}. I am reaching out regarding your ${lead.project.toLowerCase()} project in ${lead.market}. We are available to discuss the scope, timeline and an estimate. Reply with the best time to talk and any project details or photos you have. Thank you - Anthony, ${brand}`
    };
}

function isDirectDemandLead(lead: Lead): boolean {
    const source = lead.source.toLowerCase();
    return source.includes('google ads') || source.includes('thumbtack') || source === 'manual' || source.includes('public reddit');
}

async function recordOutreach(event: OutreachEvent) {
    await db.add('outreach_events', [event]);
}

async function batchDataSkipTrace(input: BatchDataSkipTraceRequest): Promise<unknown> {
    const names = await secrets.listSecretNames();
    if (!names.includes('BATCHDATA_API_TOKEN')) throw new Error('BatchData API token is not configured');
    const address = String(input.address || '').trim();
    const city = String(input.city || '').trim();
    const state = String(input.state || '').trim().toUpperCase();
    const zip = String(input.zip || '').trim();
    if (!address || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) throw new Error('A complete US property address is required');
    const request: Record<string, unknown> = { propertyAddress: { street: address, city, state, zip } };
    if (input.firstName || input.lastName) request.name = { first: String(input.firstName || '').trim(), last: String(input.lastName || '').trim() };
    const token = await secrets.readSecret('BATCHDATA_API_TOKEN');
    const response = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [request] })
    });
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 500) }; }
    if (!response.ok) {
        console.warn(`BatchData skip trace failed with ${response.status}`);
        throw new Error(`BatchData skip trace failed (${response.status})`);
    }
    return payload;
}

async function sendResendEmail(to: string, subject: string, text: string): Promise<boolean> {
    const names = await secrets.listSecretNames();
    if (!names.includes('RESEND_API_KEY') || !names.includes('RESEND_FROM_EMAIL')) return false;
    const apiKey = await secrets.readSecret('RESEND_API_KEY');
    const from = await secrets.readSecret('RESEND_FROM_EMAIL');
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text })
    });
    return response.ok;
}

async function notifyOwner(alert: OwnerAlert) {
    const names = await secrets.listSecretNames();
    if (!names.includes('RESEND_API_KEY') || !names.includes('RESEND_FROM_EMAIL') || !names.includes('OWNER_ALERT_EMAIL')) return;
    const ownerEmail = await secrets.readSecret('OWNER_ALERT_EMAIL');
    const details = [alert.phone ? `Phone: ${alert.phone}` : '', alert.email ? `Email: ${alert.email}` : '', alert.sourceUrl ? `Source: ${alert.sourceUrl}` : ''].filter(Boolean).join('\n');
    await sendResendEmail(ownerEmail, `V10 action needed: ${alert.leadName}`, `${alert.instruction}\n\n${alert.project} - ${alert.market}\n${details}`);
}

async function createOwnerAlert(leadId: string, lead: Lead, instruction: string): Promise<OwnerAlert> {
    const { items } = await db.list<OwnerAlert>('owner_alerts', { limit: 100 });
    const existing = items.find(item => item.leadId === leadId && item.status === 'open');
    if (existing) return existing;
    const alert: OwnerAlert = {
        leadId,
        leadName: lead.name,
        market: lead.market,
        project: lead.project,
        phone: lead.phone || '',
        email: lead.email || '',
        sourceUrl: sourceUrlFromNotes(lead.notes || ''),
        instruction,
        status: 'open',
        createdAt: new Date().toISOString(),
        resolvedAt: ''
    };
    const [id] = await db.add('owner_alerts', [alert]);
    if (!id) throw new Error('Failed to create owner alert');
    await recordOutreach({ leadId, leadName: lead.name, channel: 'owner-alert', destination: alert.email || alert.phone || alert.sourceUrl || 'V10', status: 'queued', reason: instruction, createdAt: alert.createdAt });
    await notifyOwner(alert);
    return { ...alert, id } as OwnerAlert;
}

async function processLeadContact(leadId: string, lead: Lead): Promise<{ action: string; sent: boolean }> {
    if (TERMINAL_STATUSES.has(lead.status) || lead.source.toLowerCase().includes('test')) return { action: 'ignored', sent: false };
    const { items: outreach } = await db.list<OutreachEvent>('outreach_events', { limit: 100 });
    if (outreach.some(item => item.leadId === leadId && item.channel === 'email' && item.status === 'sent')) return { action: 'already-contacted', sent: true };
    if (lead.email && isDirectDemandLead(lead)) {
        const copy = outreachCopy(lead);
        const sent = await sendResendEmail(lead.email, copy.subject, copy.text);
        if (sent) {
            const now = new Date().toISOString();
            await recordOutreach({ leadId, leadName: lead.name, channel: 'email', destination: lead.email, status: 'sent', reason: 'Automatic qualified-lead outreach', createdAt: now });
            await db.update('leads', [{ id: leadId, record: { ...lead, status: 'Contacted', nextAction: 'Follow up for response and qualification', nextActionDue: new Date(Date.now() + 86400000).toISOString().slice(0, 10), lastTouch: now, statusUpdatedAt: now } }]);
            return { action: 'email-sent', sent: true };
        }
        await createOwnerAlert(leadId, lead, `Email ${lead.email} manually; automatic email provider is not configured or delivery failed.`);
        return { action: 'email-escalated', sent: false };
    }
    if (lead.phone) {
        await createOwnerAlert(leadId, lead, `Call or text ${lead.phone} now and qualify the project.`);
        return { action: 'phone-escalated', sent: false };
    }
    const sourceUrl = sourceUrlFromNotes(lead.notes || '');
    if (sourceUrl) {
        await createOwnerAlert(leadId, lead, 'Open the source link and message the customer through the permitted platform channel.');
        return { action: 'source-escalated', sent: false };
    }
    await createOwnerAlert(leadId, lead, 'Research a legitimate customer contact method before outreach.');
    return { action: 'research-escalated', sent: false };
}

async function contactOrchestrationSweep() {
    const { items } = await db.list<Lead>('leads', { limit: 100 });
    let processed = 0;
    for (const lead of items.slice().sort((a, b) => revenuePriority(b) - revenuePriority(a))) {
        if (processed >= 20) break;
        await processLeadContact(lead.id, lead);
        processed += 1;
    }
    return processed;
}

function conversionPriority(lead: Lead): number {
    const stageWeight: Record<string, number> = {
        'Deposit Due': 700,
        'Won/Active': 650,
        'Estimate/Bid': 550,
        'Qualified': 450,
        'Responded': 350,
        'Contacted': 250,
        'New Lead': 150,
        'Hold': 25,
        'Cash Collected': -100,
        'Lost': -200
    };
    const today = new Date().toISOString().slice(0, 10);
    const overdueBoost = lead.nextActionDue && lead.nextActionDue < today && !['Cash Collected', 'Lost'].includes(lead.status) ? 125 : 0;
    const valueBoost = Math.min(Math.floor((lead.estimatedValue || 0) / 5000) * 10, 100);
    return (stageWeight[lead.status] || 100) + overdueBoost + valueBoost + (lead.score || 0);
}

const TERMINAL_STATUSES = new Set(['Cash Collected', 'Lost']);

function recommendedAction(status: string): string {
    const actions: Record<string, string> = {
        'New Lead': 'Contact and qualify opportunity',
        'Contacted': 'Follow up for response and qualification',
        'Responded': 'Confirm scope, budget, timeline and site visit',
        'Qualified': 'Schedule site visit or prepare estimate',
        'Estimate/Bid': 'Follow up on estimate and ask for decision',
        'Deposit Due': 'Collect deposit and confirm start date',
        'Won/Active': 'Advance project milestone and collect scheduled payment',
        'Hold': 'Confirm whether timing or blocker has changed'
    };
    return actions[status] || 'Review opportunity and choose next revenue action';
}

function stageProbability(status: string): number {
    const probabilities: Record<string, number> = {
        'New Lead': 0.08,
        'Contacted': 0.15,
        'Responded': 0.25,
        'Qualified': 0.4,
        'Estimate/Bid': 0.55,
        'Deposit Due': 0.8,
        'Won/Active': 0.95,
        'Hold': 0.1,
        'Cash Collected': 1,
        'Lost': 0
    };
    return probabilities[status] ?? 0.05;
}

function revenuePriority(lead: Lead): number {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = Boolean(lead.nextActionDue && lead.nextActionDue < today && !TERMINAL_STATUSES.has(lead.status));
    const staleDays = Math.max(0, Math.floor((Date.now() - Date.parse(lead.lastTouch || lead.createdAt || new Date().toISOString())) / 86400000));
    const expectedValue = (lead.estimatedValue || 0) * stageProbability(lead.status);
    return conversionPriority(lead) + (overdue ? 200 : 0) + Math.min(staleDays * 8, 120) + Math.min(Math.floor(expectedValue / 1000), 150);
}

async function buildCommandCenter() {
    const [{ items }, genome] = await Promise.all([db.list<Lead>('leads', { limit: 100 }), activeGenome()]);
    const real = items.filter(lead => !lead.source.toLowerCase().includes('test'));
    const active = real.filter(lead => !TERMINAL_STATUSES.has(lead.status));
    const today = new Date().toISOString().slice(0, 10);
    const overdue = active.filter(lead => lead.nextActionDue && lead.nextActionDue < today);
    const missingAction = active.filter(lead => !lead.nextAction.trim());
    const queue = active.slice().sort((a, b) => strategyPriority(b, genome) - strategyPriority(a, genome)).slice(0, 5).map(lead => ({
        id: lead.id,
        name: lead.name,
        market: lead.market,
        project: lead.project,
        source: lead.source,
        status: lead.status,
        score: lead.score,
        estimatedValue: lead.estimatedValue,
        expectedValue: Math.round((lead.estimatedValue || 0) * stageProbability(lead.status)),
        nextAction: lead.nextAction || recommendedAction(lead.status),
        nextActionDue: lead.nextActionDue,
        priority: strategyPriority(lead, genome)
    }));
    const pipelineValue = active.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0);
    const weightedPipelineValue = active.reduce((sum, lead) => sum + (lead.estimatedValue || 0) * stageProbability(lead.status), 0);
    return {
        generatedAt: new Date().toISOString(),
        activeOpportunities: active.length,
        overdueActions: overdue.length,
        missingActions: missingAction.length,
        pipelineValue,
        weightedPipelineValue: Math.round(weightedPipelineValue),
        coverageToMillionTarget: Number((pipelineValue / 1000000).toFixed(2)),
        strategyGeneration: genome.generation,
        strategyFitness: genome.fitness,
        executiveQueue: queue
    };
}

export const revenueOpsSweep = async () => {
    const [{ items }, genome] = await Promise.all([db.list<Lead>('leads', { limit: 100 }), activeGenome()]);
    const today = new Date().toISOString().slice(0, 10);
    const defaultDue = new Date(Date.now() + Math.max(1, Math.ceil(genome.followUpHours / 24)) * 86400000).toISOString().slice(0, 10);
    const repairs: Array<{ id: string; record: Record<string, unknown> }> = [];
    for (const lead of items) {
        if (TERMINAL_STATUSES.has(lead.status)) continue;
        const action = lead.nextAction?.trim() || recommendedAction(lead.status);
        const due = lead.nextActionDue || defaultDue;
        if (action !== lead.nextAction || due !== lead.nextActionDue) {
            repairs.push({ id: lead.id, record: { ...lead, nextAction: action, nextActionDue: due } });
        }
    }
    if (repairs.length) await db.update('leads', repairs.slice(0, 100));
    const commandCenter = await buildCommandCenter();
    const { items: states } = await db.list<Record<string, unknown>>('revenue_ops_state', { limit: 1 });
    const state = { ...commandCenter, repairedRecords: repairs.length, sweepDate: today };
    if (states.length) await db.update('revenue_ops_state', [{ id: states[0].id, record: state }]);
    else await db.add('revenue_ops_state', [state]);
    return { statusCode: 200 };
};

export const v10ControlLoop = async () => {
    await publicOpportunityScan();
    await batchEnrichmentSweep();
    await strategyEvolutionSweep();
    await contactOrchestrationSweep();
    await revenueOpsSweep();
    return { statusCode: 200 };
};

type EmailSignal = { eventType: string; emailId: string; from: string; to: string[]; subject: string; receivedAt: string; requiresReview: boolean; disposition: string };

function verifyResendSignature(event: any, rawBody: string, secret: string): boolean {
    const headers = event?.headers || {};
    const id = headers['svix-id'] || headers['Svix-Id'] || '';
    const timestamp = headers['svix-timestamp'] || headers['Svix-Timestamp'] || '';
    const signatureHeader = headers['svix-signature'] || headers['Svix-Signature'] || '';
    if (!id || !timestamp || !signatureHeader || !rawBody) return false;
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;
    const encodedSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    let key: Buffer;
    try { key = Buffer.from(encodedSecret, 'base64'); } catch { return false; }
    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
    const candidates = String(signatureHeader).split(' ').map((part: string) => part.startsWith('v1,') ? part.slice(3) : '').filter(Boolean);
    return candidates.some((candidate: string) => {
        const a = Buffer.from(candidate);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
    });
}

async function storeEmailSignal(payload: any): Promise<EmailSignal> {
    const data = payload?.data || {};
    const eventType = String(payload?.type || 'unknown');
    const subject = String(data?.subject || 'No subject').slice(0, 300);
    const from = String(data?.from || '').slice(0, 320);
    const to = Array.isArray(data?.to) ? data.to.map((value: unknown) => String(value).slice(0, 320)).slice(0, 20) : [];
    const emailId = String(data?.email_id || data?.id || '').slice(0, 200);
    const revenueTerms = ['lead', 'estimate', 'quote', 'project', 'contractor', 'vendor', 'onboarding', 'remodel', 'renovation', 'electrical', 'bathroom', 'kitchen', 'addition', 'fence', 'payment', 'deposit', 'approved', 'application'];
    const likelyRevenue = revenueTerms.some(term => subject.toLowerCase().includes(term));
    const disposition = eventType === 'email.bounced' || eventType === 'email.failed' ? 'failed-outreach' : likelyRevenue ? 'review-priority' : 'review-normal';
    const signal: EmailSignal = { eventType, emailId, from, to, subject, receivedAt: new Date().toISOString(), requiresReview: true, disposition };
    await db.add('email_signals', [signal]);
    return signal;
}

export const handler = router({
    'GET /api/_healthcheck': [async () => json({ ok: true, app: 'ABW Lead Engine V10' })],
    'GET /api/integrations/resend/status': [async () => {
        const names = await secrets.listSecretNames();
        return json({ configured: names.includes('RESEND_WEBHOOK_SECRET'), endpoint: '/webhooks/resend' });
    }],
    'GET /api/email-signals': [async () => {
        const { items } = await db.list<EmailSignal>('email_signals', { limit: 50 });
        return json({ signals: items.slice().sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)) });
    }],
    'POST /webhooks/resend': [async ({ body, event }) => {
        const names = await secrets.listSecretNames();
        if (!names.includes('RESEND_WEBHOOK_SECRET')) return error('Resend webhook verification is not configured', 503);
        const secret = await secrets.readSecret('RESEND_WEBHOOK_SECRET');
        const rawBody = typeof event?.body === 'string' ? event.body : JSON.stringify(body || {});
        if (!verifyResendSignature(event, rawBody, secret)) return error('Invalid webhook signature', 401);
        const payload = body as any;
        const allowed = new Set(['email.received', 'email.bounced', 'email.failed', 'email.delivery_delayed', 'email.complained', 'email.suppressed']);
        if (!allowed.has(String(payload?.type || ''))) return json({ ok: true, ignored: true });
        const signal = await storeEmailSignal(payload);
        return json({ ok: true, accepted: true, disposition: signal.disposition });
    }],
    'GET /api/contact-center': [async () => {
        const [{ items: alerts }, { items: outreach }, names] = await Promise.all([
            db.list<OwnerAlert>('owner_alerts', { limit: 100 }),
            db.list<OutreachEvent>('outreach_events', { limit: 100 }),
            secrets.listSecretNames()
        ]);
        return json({
            alerts: alerts.filter(item => item.status === 'open').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
            recentOutreach: outreach.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 25),
            automaticEmailReady: names.includes('RESEND_API_KEY') && names.includes('RESEND_FROM_EMAIL'),
            ownerEmailAlertsReady: names.includes('RESEND_API_KEY') && names.includes('RESEND_FROM_EMAIL') && names.includes('OWNER_ALERT_EMAIL')
        });
    }],
    'POST /api/contact-center/:leadId/run': [async ({ params }) => {
        const [lead] = await db.get<Lead>('leads', [params.leadId]);
        if (!lead) return error('Lead not found', 404);
        return json({ ok: true, ...(await processLeadContact(params.leadId, lead)) });
    }],
    'POST /api/owner-alerts/:id/resolve': [async ({ params }) => {
        const [alert] = await db.get<OwnerAlert>('owner_alerts', [params.id]);
        if (!alert) return error('Alert not found', 404);
        const record = { ...alert, status: 'resolved' as const, resolvedAt: new Date().toISOString() };
        const [updated] = await db.update('owner_alerts', [{ id: params.id, record }]);
        if (!updated) return error('Failed to resolve alert', 500);
        return json({ ok: true });
    }],
    'GET /api/command-center': [async () => json(await buildCommandCenter())],
    'GET /api/revenue-ops/state': [async () => {
        const { items } = await db.list<Record<string, unknown>>('revenue_ops_state', { limit: 1 });
        return json({ state: items[0] || null });
    }],
    'GET /api/source-intelligence': [async () => {
        const { items } = await db.list<SourceIntelligence>('source_intelligence', { limit: 50 });
        const sources = items.slice().sort((a, b) => b.explorationScore - a.explorationScore);
        return json({ sources, procurementAdvantages: await procurementAdvantageSnapshot(), strategy: 'Bayesian yield posterior plus UCB-style exploration bonus; productive sources scan faster while weak sources remain periodically explored.' });
    }],
    'GET /api/procurement-advantages': [async () => json({ opportunities: await procurementAdvantageSnapshot(), model: 'incumbent-reverse-map + small-business-access + subcontract-first' })],
    'GET /api/self-improvement': [async () => {
        const [genome, { items: history }] = await Promise.all([activeGenome(), db.list<EvolutionRecord>('evolution_history', { limit: 20 })]);
        return json({ genome, history: history.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8), safeguards: ['bounded parameter mutation', 'fitness rollback', 'daily AI innovation only', 'code changes gated behind deployment validation'] });
    }],
    'POST /api/self-improvement/evolve': [async () => json({ ok: true, ...(await strategyEvolutionSweep(true)) })],
    'GET /api/software-evolution': [async () => { const [{ items: upgrades }, { items: releaseRuns }] = await Promise.all([db.list<SoftwareUpgrade>('software_upgrades', { limit: 30 }), db.list<ReleaseRun>('release_runs', { limit: 30 })]); return json({ upgrades: upgrades.slice().sort((a, b) => b.priority - a.priority), releaseRuns: releaseRuns.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), policy: { autoSafe: 'Low-risk reversible operating changes may run through bounded canary and auto-promote or rollback.', gated: 'Production source code and consequential changes generate a deployment-ready package but remain behind external platform validation.', releaseStages: ['candidate package','static policy gate','isolated shadow score','bounded canary','promote or rollback','external deploy gate for code'] } }); }],
    'POST /api/software-evolution/generate': [async () => json({ ok: true, ...(await softwareUpgradePipeline()) })],
    'POST /api/software-evolution/:id/decision': [async ({ params, body }) => { const input = body as { decision?: string }; if (!['approved','rejected'].includes(input.decision || '')) return error('Decision must be approved or rejected.', 400); const { items } = await db.list<SoftwareUpgrade>('software_upgrades', { limit: 100 }); const item = items.find(candidate => candidate.id === params.id); if (!item) return error('Upgrade proposal not found.', 404); await db.update('software_upgrades', [{ id: params.id, record: { ...item, status: input.decision as 'approved' | 'rejected' } }]); return json({ ok: true, status: input.decision }); }],
    'POST /api/software-evolution/:id/run-release': [async ({ params }) => { try { return json({ ok: true, run: await releasePipelineFor(params.id) }); } catch (err) { return error(String(err), 400); } }],
    'GET /api/leads': [async () => {
        const { items } = await db.list<Lead>('leads', { limit: 100 });
        const leads = items.slice().sort((a, b) => {
            const priorityDiff = conversionPriority(b) - conversionPriority(a);
            if (priorityDiff !== 0) return priorityDiff;
            return Date.parse(b.createdAt || '1970-01-01') - Date.parse(a.createdAt || '1970-01-01');
        });
        return json({ leads });
    }],
    'POST /api/leads': [async ({ body }) => {
        const input = body as IncomingLead;
        if (!input?.name?.trim()) return error('Lead name is required', 400);
        return json({ ok: true, lead: await addLead(input) }, 201);
    }],
    'PUT /api/leads/:id/status': [async ({ params, body }) => {
        const allowed = ['New Lead', 'Contacted', 'Responded', 'Qualified', 'Estimate/Bid', 'Deposit Due', 'Won/Active', 'Cash Collected', 'Hold', 'Lost'];
        const nextStatus = String((body as { status?: string })?.status || '');
        if (!allowed.includes(nextStatus)) return error('Invalid lead status', 400);
        const [existing] = await db.get<Lead>('leads', [params.id]);
        if (!existing) return error('Lead not found', 404);
        const now = new Date().toISOString();
        const [updated] = await db.update('leads', [{ id: params.id, record: { ...existing, status: nextStatus, statusUpdatedAt: now, lastTouch: now } }]);
        if (!updated) return error('Failed to update lead', 500);
        return json({ ok: true, lead: { id: params.id, ...existing, status: nextStatus, statusUpdatedAt: now, lastTouch: now } });
    }],
    'PUT /api/leads/:id/operator': [async ({ params, body }) => {
        const input = (body || {}) as { estimatedValue?: number; nextAction?: string; nextActionDue?: string };
        const [existing] = await db.get<Lead>('leads', [params.id]);
        if (!existing) return error('Lead not found', 404);
        const nextValue = input.estimatedValue === undefined ? existing.estimatedValue || 0 : Math.max(0, Number(input.estimatedValue || 0));
        const nextAction = input.nextAction === undefined ? existing.nextAction || '' : String(input.nextAction).trim().slice(0, 240);
        const nextActionDue = input.nextActionDue === undefined ? existing.nextActionDue || '' : String(input.nextActionDue).slice(0, 10);
        const now = new Date().toISOString();
        const record = { ...existing, estimatedValue: nextValue, nextAction, nextActionDue, lastTouch: now };
        const [updated] = await db.update('leads', [{ id: params.id, record }]);
        if (!updated) return error('Failed to update lead', 500);
        return json({ ok: true, lead: { id: params.id, ...record } });
    }],
    'GET /api/integrations/thumbtack/status': [async () => {
        const names = await secrets.listSecretNames();
        return json({ configured: names.includes('THUMBTACK_WEBHOOK_SECRET'), endpoint: '/webhooks/thumbtack' });
    }],
    'GET /api/integrations/google-ads/status': [async () => {
        const names = await secrets.listSecretNames();
        return json({ configured: names.includes('GOOGLE_ADS_WEBHOOK_SECRET'), endpoint: '/webhooks/google-ads' });
    }],
    'GET /api/integrations/sam/status': [async () => {
        const names = await secrets.listSecretNames();
        return json({ configured: names.includes('SAM_GOV_API_KEY'), endpoint: '/api/government-opportunities/scan', markets: GOVERNMENT_STATES });
    }],
    'GET /api/integrations/batchdata/status': [async () => {
        const names = await secrets.listSecretNames();
        return json({ configured: names.includes('BATCHDATA_API_TOKEN'), provider: 'BatchData', endpoint: '/api/property/skip-trace' });
    }],
    'POST /api/contact-now/enrich': [async () => {
        try {
            const matched = await batchEnrichmentSweep(true);
            const { items } = await db.list<Lead>('leads', { limit: 100 });
            const contactable = items.filter(lead => Boolean((lead.phone || lead.email) && !['Cash Collected', 'Lost'].includes(lead.status))).length;
            return json({ ok: true, matched, contactable });
        } catch (err) {
            console.warn('On-demand BatchData enrichment failed', err);
            return error('BatchData enrichment is temporarily unavailable', 502);
        }
    }],
    'POST /api/property/skip-trace': [async ({ body }) => {
        try {
            const result = await batchDataSkipTrace((body || {}) as BatchDataSkipTraceRequest);
            return json({ ok: true, provider: 'BatchData', result, complianceNote: 'Returned contact data is not consent to market. Preserve and enforce DNC/TCPA/litigator/verification flags before outreach.' });
        } catch (err) {
            const message = String(err);
            if (message.includes('not configured')) return error('BatchData API token is not configured', 503);
            if (message.includes('complete US property address')) return error('A complete US property address is required', 400);
            return error('BatchData skip trace is temporarily unavailable', 502);
        }
    }],
    'POST /api/public-opportunities/scan': [async () => {
        try {
            const result = await scanPublicMarkets();
            return json({ ok: true, ...result, markets: ['Charlotte / Lake Norman', 'Hampton Roads / Virginia Beach', 'New York City', 'NC / VA / NY / NJ government'] });
        } catch (err) {
            console.warn('On-demand public opportunity scan failed', err);
            return error('Public opportunity sources are temporarily unavailable', 502);
        }
    }],
    'POST /api/government-opportunities/scan': [async () => {
        try {
            const result = await scanSamGovernmentOpportunities();
            if (!result.configured) return error('SAM.gov API key is not configured', 503);
            return json({ ok: true, ...result, markets: GOVERNMENT_STATES });
        } catch (err) {
            console.warn('SAM.gov opportunity scan failed', err);
            return error('SAM.gov opportunity source is temporarily unavailable', 502);
        }
    }],
    'POST /webhooks/google-ads': [async ({ body }) => {
        const names = await secrets.listSecretNames();
        if (!names.includes('GOOGLE_ADS_WEBHOOK_SECRET')) return error('Google Ads webhook secret not configured', 503);
        const expected = await secrets.readSecret('GOOGLE_ADS_WEBHOOK_SECRET');
        const payload = (body || {}) as GoogleAdsLead;
        const supplied = payload.google_key || payload.Google_key || '';
        if (!supplied || supplied !== expected) return error('Unauthorized webhook', 401);
        if (!payload.lead_id) return error('lead_id is required', 400);
        const externalId = `google:${payload.lead_id}`;
        const known = await recentExternalIds();
        if (known.has(externalId)) return json({});
        await addLead(googleAdsToLead(payload), payload.is_test ? 'Google Ads Test' : 'Google Ads');
        return json({});
    }],
    'POST /webhooks/thumbtack': [async ({ body, event }) => {
        const names = await secrets.listSecretNames();
        if (!names.includes('THUMBTACK_WEBHOOK_SECRET')) return error('Thumbtack webhook secret not configured', 503);
        const expected = await secrets.readSecret('THUMBTACK_WEBHOOK_SECRET');
        const headers = event?.headers || {};
        const authorization = headers.authorization || headers.Authorization || '';
        const legacySecret = headers['x-webhook-secret'] || headers['X-Webhook-Secret'] || headers['x-thumbtack-secret'] || headers['X-Thumbtack-Secret'];
        let authorized = legacySecret === expected;
        if (!authorized && authorization.startsWith('Basic ')) {
            const decoded = decodeBase64(authorization.slice(6));
            const separator = decoded.indexOf(':');
            const password = separator >= 0 ? decoded.slice(separator + 1) : '';
            authorized = password === expected;
        }
        if (!authorized) return error('Unauthorized webhook', 401);
        const lead = await addLead(thumbtackToLead(body), 'Thumbtack');
        return json({ ok: true, received: true, leadId: lead.id });
    }],
    'POST /api/test-thumbtack': [async () => {
        const lead = await addLead({ name: 'Thumbtack Test Lead', market: 'Virginia', project: 'General Remodeling', notes: 'Synthetic webhook test from V10.' }, 'Thumbtack Test');
        return json({ ok: true, lead });
    }],
    'POST /api/test-google-ads': [async () => {
        const lead = await addLead({ name: 'Google Ads Test Lead', phone: '+17045550101', email: 'google-test@example.com', market: 'Charlotte / Lake Norman', project: 'Google Ads Lead Form', notes: 'Synthetic Google Ads intake test from V10.' }, 'Google Ads Test');
        return json({ ok: true, lead });
    }]
});