import { db, error, json, router, secrets } from '@appdeploy/sdk';

type IncomingLead = { name?: string; phone?: string; email?: string; market?: string; project?: string; source?: string; notes?: string; value?: number; nextAction?: string; nextActionDue?: string; event?: string; lead_id?: string; request?: { name?: string; phone?: string; email?: string; category?: string; description?: string; location?: string } };

type ThumbtackNegotiation = { negotiationID?: string; category?: { name?: string }; customer?: { displayName?: string; phoneNumber?: string; email?: string; location?: { city?: string; state?: string; zipCode?: string } }; details?: Array<{ question?: string; answer?: string }>; createTime?: string };
type GoogleLeadColumn = { column_id?: string; column_name?: string; string_value?: string };
type GoogleAdsLead = { lead_id?: string; campaign_id?: number | string; form_id?: number | string; adgroup_id?: number | string; creative_id?: number | string; gcl_id?: string; google_key?: string; Google_key?: string; is_test?: boolean; user_column_data?: GoogleLeadColumn[] };

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

type Lead = { name: string; phone: string; email: string; market: string; project: string; source: string; notes: string; status: string; score: number; createdAt: string; externalId: string; estimatedValue: number; nextAction: string; nextActionDue: string; lastTouch: string; statusUpdatedAt: string };

type RedditListing = { data?: { children?: Array<{ data?: { id?: string; title?: string; selftext?: string; author?: string; permalink?: string } }> } };

const PUBLIC_KEYWORDS = ['contractor', 'remodel', 'renovation', 'addition', 'add on', 'room addition', 'garage conversion', 'electrician', 'electrical', 'fence', 'fencing', 'bathroom', 'shower', 'walk-in shower', 'tub', 'accessibility', 'handicap', 'kitchen', 'cabinet', 'deck', 'porch', 'flooring', 'drywall', 'roof', 'chimney', 'structural', 'water damage', 'handyman', 'repair', 'rehab', 'full rehab', 'whole home'];
const DEMAND_PHRASES = ['looking for', 'need ', 'i need', 'i want', 'want to', 'recommend', 'recommendation', 'quote', 'estimate', 'cost is', 'how much', 'planning', 'seeking', 'anyone know', 'who can', 'hire', 'contractor needed', 'repair or replace'];

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

function looksLikeOpportunity(text: string): boolean {
    const value = text.toLowerCase();
    return PUBLIC_KEYWORDS.some(keyword => value.includes(keyword)) && DEMAND_PHRASES.some(phrase => value.includes(phrase));
}

async function recentExternalIds(): Promise<Set<string>> {
    const { items } = await db.list<Lead>('leads', { limit: 100 });
    return new Set(items.map(item => item.externalId).filter(Boolean));
}

async function scanRedditMarket(subreddit: string, market: string, source: string): Promise<{ added: number; scanned: number }> {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`;
    const response = await fetch(url, { headers: { 'User-Agent': 'ABWLeadEngineV10/1.0 public-opportunity-monitor' } });
    if (!response.ok) throw new Error(`${source} returned ${response.status}`);
    const listing = await response.json() as RedditListing;
    const children = listing.data?.children || [];
    const known = await recentExternalIds();
    let added = 0;
    for (const child of children) {
        const post = child.data || {};
        const id = post.id || '';
        const externalId = `reddit:${subreddit}:${id}`;
        if (!id || known.has(externalId)) continue;
        const text = `${post.title || ''}\n${post.selftext || ''}`.trim();
        if (!looksLikeOpportunity(text)) continue;
        const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
        await addLead({
            name: post.author ? `Reddit opportunity - u/${post.author}` : 'Reddit project opportunity',
            market,
            project: classifyProject(text),
            source,
            notes: `${post.title || 'Project request'}${post.selftext ? ` | ${post.selftext.slice(0, 700)}` : ''}${permalink ? ` | Contact/post: ${permalink}` : ''}`,
            lead_id: externalId
        }, source);
        known.add(externalId);
        added += 1;
        if (added >= 20) break;
    }
    return { added, scanned: children.length };
}

async function scanPublicMarkets() {
    const sources = [
        { subreddit: 'Charlotte', market: 'Charlotte / Lake Norman', source: 'Public Reddit - Charlotte' },
        { subreddit: 'nyc', market: 'New York City', source: 'Public Reddit - NYC' },
        { subreddit: 'AskNYC', market: 'New York City', source: 'Public Reddit - AskNYC' },
        { subreddit: 'VirginiaBeach', market: 'Hampton Roads / Virginia Beach', source: 'Public Reddit - Virginia Beach' },
        { subreddit: 'HamptonRoads', market: 'Hampton Roads / Virginia Beach', source: 'Public Reddit - Hampton Roads' }
    ];
    const results = [];
    for (const item of sources) {
        try {
            results.push({ ...item, ...(await scanRedditMarket(item.subreddit, item.market, item.source)) });
        } catch (err) {
            console.warn(`${item.source} scan failed`, err);
            results.push({ ...item, added: 0, scanned: 0 });
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
    if (DEMAND_PHRASES.some(phrase => text.includes(phrase))) score += 10;
    if (['addition', 'kitchen', 'bathroom', 'electrical', 'renovation', 'remodel', 'garage conversion', 'full rehab', 'whole home', 'structural', 'roof', 'water damage'].some(term => text.includes(term))) score += 10;
    if (['asap', 'urgent', 'within the next', 'this month', 'soon'].some(term => text.includes(term))) score += 10;
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

export const handler = router({
    'GET /api/_healthcheck': [async () => json({ ok: true, app: 'ABW Lead Engine V10' })],
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
    'POST /api/public-opportunities/scan': [async () => {
        try {
            const result = await scanPublicMarkets();
            return json({ ok: true, ...result, markets: ['Charlotte / Lake Norman', 'Hampton Roads / Virginia Beach', 'New York City'] });
        } catch (err) {
            console.warn('On-demand public opportunity scan failed', err);
            return error('Public opportunity sources are temporarily unavailable', 502);
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