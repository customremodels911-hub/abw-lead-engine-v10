type ApiResponse<T = any> = { data: T };

function getDashboardKey(): string {
  let key = sessionStorage.getItem('v10_access_key') || '';
  if (key) return key;
  key = (window.prompt('Enter your private V10 dashboard access key') || '').trim();
  if (!key) throw new Error('V10 dashboard access key is required. Reload to try again.');
  sessionStorage.setItem('v10_access_key', key);
  return key;
}

async function request<T = any>(method: string, url: string, body?: any): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'x-v10-access-key': getDashboardKey() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('v10_access_key');
      throw new Error('Incorrect V10 access key. Reload the page and enter the correct key.');
    }
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return { data };
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: any) => request<T>('POST', url, body),
  put: <T = any>(url: string, body?: any) => request<T>('PUT', url, body)
};
