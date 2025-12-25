import { fetchJson } from '../../lib/http.js';
import { escapeHtml } from '../../lib/dom.js';

const APP_ID = 'conditions';

// Simple in-memory cache for the session
let cachedList = null; // Array<{ slug, name, desc }>
let inflight = null; // Promise

async function getConditionsOnce() {
  if (cachedList) return cachedList;
  if (inflight) return inflight;
  inflight = (async () => {
    const data = await fetchJson('/api/open5e/conditions/');
    const results = Array.isArray(data?.results) ? data.results : [];
    cachedList = results.map(r => ({ slug: r.slug, name: r.name, desc: r.desc || '' }));
    return cachedList;
  })();
  try { return await inflight; } finally { inflight = null; }
}

function renderDescBlocks(descText) {
  // Parse into paragraphs and bullet lists (lines starting with "* ")
  const root = document.createDocumentFragment();
  const lines = String(descText || '').split('\n');
  let buf = [];
  let ul = null;
  const flushParagraph = () => {
    if (buf.length) {
      const p = document.createElement('p');
      p.textContent = buf.join('\n');
      root.appendChild(p);
      buf = [];
    }
  };
  const closeUl = () => { if (ul) { root.appendChild(ul); ul = null; } };

  for (const rawLine of lines) {
    const m = rawLine.match(/^\s*\*\s+(.*)$/);
    if (m) {
      // Bullet
      flushParagraph();
      if (!ul) ul = document.createElement('ul');
      const li = document.createElement('li');
      li.textContent = m[1] || '';
      ul.appendChild(li);
    } else if (rawLine.trim() === '') {
      // Blank line: new paragraph boundary
      closeUl();
      flushParagraph();
    } else {
      // Normal text
      closeUl();
      buf.push(rawLine);
    }
  }
  closeUl();
  flushParagraph();
  return root;
}

export const ConditionsApp = {
  id: APP_ID,
  title: 'Conditions',
  surfaces: ['rightPanel'],
  mount(rootEl) {
    const slot = (rootEl || document).querySelector('#rightConditionsSlot');
    if (!slot) return () => {};

    let cancelled = false;
    slot.innerHTML = '<p class="meta">Loading…</p>';

    getConditionsOnce()
      .then(list => {
        if (cancelled) return;
        const container = document.createElement('div');
        container.setAttribute('id', 'conditionsList');

        list
          .slice()
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .forEach(item => {
            const details = document.createElement('details');
            details.className = 'cond-item';

            const summary = document.createElement('summary');
            summary.textContent = item.name || item.slug || 'Condition';
            details.appendChild(summary);

            const desc = document.createElement('div');
            desc.className = 'cond-desc';
            // Build blocks safely (no HTML injection; textContent used)
            desc.appendChild(renderDescBlocks(item.desc || ''));
            details.appendChild(desc);

            container.appendChild(details);
          });

        slot.innerHTML = '';
        slot.appendChild(container);
      })
      .catch(() => {
        if (cancelled) return;
        slot.innerHTML = '<p class="meta">Failed to load conditions</p>';
      });

    return () => { cancelled = true; };
  },
  unmount() {},
};

