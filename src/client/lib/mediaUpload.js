// Minimal helper for uploading media via /api/media

export async function uploadMedia({ scope, pageId, surfaceId, slot, file }) {
  const params = new URLSearchParams();
  params.set('scope', scope);
  params.set('slot', slot);
  if (scope === 'page' && pageId) params.set('pageId', pageId);
  if (scope === 'surface' && surfaceId) params.set('surfaceId', surfaceId);
  const res = await fetch(`/api/media/upload?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${t ? ` — ${t}` : ''}`);
  }
  return res.json();
}

export async function updatePosition({ scope, pageId, surfaceId, slot, posX, posY, zoom }) {
  const res = await fetch('/api/media/position', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope,
      pageId,
      surfaceId,
      slot,
      posX,
      posY,
      ...(Number.isFinite(zoom) ? { zoom } : {})
    })
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function deleteMedia({ scope, pageId, surfaceId, slot }) {
  const params = new URLSearchParams();
  params.set('scope', scope);
  params.set('slot', slot);
  if (scope === 'page' && pageId) params.set('pageId', pageId);
  if (scope === 'surface' && surfaceId) params.set('surfaceId', surfaceId);
  const res = await fetch(`/api/media?${params.toString()}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
