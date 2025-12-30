// Lightweight JSON/text fetch helper
export async function fetchJson(url, opts) {
  const useSignal = (opts && 'signal' in opts) ? opts.signal : (typeof window !== 'undefined' && window.__routeAbortSignal ? window.__routeAbortSignal : undefined);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    ...(useSignal ? { signal: useSignal } : {}),
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}
