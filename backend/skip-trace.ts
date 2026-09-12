import { secrets } from '@appdeploy/sdk';

export type SkipTraceRequest = {
  address: string;
  city: string;
  state: string;
  zip: string;
  firstName?: string;
  lastName?: string;
};

export type SkipTraceResult = {
  provider: 'batchdata';
  raw: unknown;
};

/**
 * Enrich an owner/property lead with licensed BatchData contact data.
 * Credentials are read server-side and are never exposed to the browser.
 *
 * IMPORTANT: A returned contact is not consent to market. Preserve provider
 * DNC/TCPA/litigator/verification flags and enforce them before outreach.
 */
export async function skipTraceProperty(input: SkipTraceRequest): Promise<SkipTraceResult> {
  const token = await secrets.get('BATCHDATA_API_TOKEN');
  if (!token) throw new Error('BATCHDATA_API_TOKEN is not configured');

  const payload: Record<string, unknown> = {
    propertyAddress: {
      street: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip
    }
  };

  if (input.firstName || input.lastName) {
    payload.name = {
      first: input.firstName || '',
      last: input.lastName || ''
    };
  }

  const response = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let raw: unknown;
  try { raw = text ? JSON.parse(text) : {}; } catch { raw = { message: text }; }

  if (!response.ok) {
    throw new Error(`BatchData skip trace failed (${response.status})`);
  }

  return { provider: 'batchdata', raw };
}
