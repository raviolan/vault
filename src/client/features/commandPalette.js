import { escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { navigate } from '../lib/router.js';

export function installCommandPalette() {
  if (document.getElementById('cmdp')) return;
  const wrap = document.createElement('div');
  wrap.id = 'cmdp';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div id="cmdpOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1500;"></div>
    <div id="cmdpPanel" style="position:fixed;z-index:1501;top:10%;left:50%;transform:translateX(-50%);width:720px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:10px;box-shadow:0 16px 36px rgba(0,0,0,0.45);">
      <div style="padding:8px 10px;border-bottom:1px solid #374151"><input id="cmdpInput" placeholder="Quick open..." style="width:100%;background:#0f172a;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:8px 10px;outline:none"/></div>
      <div style="display:flex;max-height:360px;">
        <div id="cmdpList" style="flex:1;overflow:auto;padding:8px 6px"></div>
        <div id="cmdpPreview" style="width:45%;border-left:1px solid #374151;padding:8px 10px;white-space:pre-wrap;opacity:0.85"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const overlay = document.getElementById('cmdpOverlay');
  const panel = document.getElementById('cmdpPanel');
  const input = document.getElementById('cmdpInput');
  const list = document.getElementById('cmdpList');
  const prev = document.getElementById('cmdpPreview');

  let items = [];
  let active = -1;
  let timer;

  function render() {
    list.innerHTML = items.map((it, idx) => `<div class="search-item${idx===active?' active':''}" data-id="${it.id}" data-slug="${it.slug||''}" style="padding:8px 10px;border-radius:6px;cursor:pointer;">${escapeHtml(it.title)}</div>`).join('');
    const sel = items[active];
    prev.innerHTML = sel ? `<div class="meta">${escapeHtml(sel.type||'')}</div><div class="search-snippet">${escapeHtml(sel.snippet||'')}</div>` : '<div class="meta">No selection</div>';
    list.querySelectorAll('.search-item').forEach((el, idx) => {
      el.addEventListener('mouseenter', () => { active = idx; render(); });
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => openActive());
    });
  }

  async function search(q) {
    const res = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    items = res?.results || [];
    active = items.length ? 0 : -1;
    render();
  }

  function openActive() {
    if (active >= 0 && active < items.length) {
      const it = items[active];
      const href = it.slug ? `/p/${encodeURIComponent(it.slug)}` : `/page/${encodeURIComponent(it.id)}`;
      hide();
      navigate(href);
    } else {
      const q = input.value.trim();
      hide();
      if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  function show() { wrap.style.display = ''; input.value=''; items=[]; active=-1; render(); setTimeout(() => input.focus(), 0); }
  function hide() { wrap.style.display = 'none'; }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      show();
    } else if (wrap.style.display !== 'none') {
      if (e.key === 'Escape') { hide(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active=(active+1)%items.length; render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active=(active-1+items.length)%items.length; render(); } }
      else if (e.key === 'Enter') { e.preventDefault(); openActive(); }
    }
  });
  overlay.addEventListener('click', () => hide());
  input.addEventListener('input', () => { clearTimeout(timer); const q=input.value.trim(); if (!q){items=[];active=-1;render();return;} timer=setTimeout(()=>void search(q), 150); });
}

