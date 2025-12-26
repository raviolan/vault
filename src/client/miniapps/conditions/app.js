import { fetchJson } from '../../lib/http.js';
import { getAppState, setAppState } from '../../miniapps/state.js';

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

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

export const ConditionsApp = {
  id: APP_ID,
  title: 'Conditions',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const slot = (ctx?.mountEl) || (rootEl || document).querySelector('#rightConditionsSlot');
    if (!slot) return () => {};

    let cancelled = false;
    slot.innerHTML = '<p class="meta">Loading…</p>';

    // Restore state
    let state = (() => {
      const s = getAppState(APP_ID, { open: {}, scrollTop: 0 });
      if (s && typeof s === 'object') return { open: (s.open || {}), scrollTop: Number(s.scrollTop) || 0 };
      return { open: {}, scrollTop: 0 };
    })();
    const persist = debounce(() => setAppState(APP_ID, state), 150);

    getConditionsOnce()
      .then(list => {
        if (cancelled) return;
        const container = document.createElement('div');
        container.setAttribute('id', 'conditionsList');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        list
          .slice()
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .forEach(item => {
            const details = document.createElement('details');
            details.className = 'cond-item';
            details.dataset.slug = item.slug || '';

            const summary = document.createElement('summary');
            summary.textContent = item.name || item.slug || 'Condition';
            details.appendChild(summary);

            const desc = document.createElement('div');
            desc.className = 'cond-desc';
            // Build blocks safely (no HTML injection; textContent used)
            desc.appendChild(renderDescBlocks(item.desc || ''));
            details.appendChild(desc);

            container.appendChild(details);

            // Restore open state
            if (state.open && state.open[item.slug]) details.open = true;

            // Track changes
            details.addEventListener('toggle', () => {
              const slug = item.slug;
              if (slug) {
                state.open = { ...(state.open || {}) };
                if (details.open) state.open[slug] = true; else delete state.open[slug];
                persist();
              }
            });
          });

        slot.innerHTML = '';
        // Ensure slot can scroll when used as a mount area
        try { slot.style.overflow = 'auto'; slot.style.minHeight = '0'; } catch {}
        slot.appendChild(container);

        // Restore scroll position if available
        if (state.scrollTop > 0) {
          try { slot.scrollTop = state.scrollTop; } catch {}
        }
      })
      .catch(() => {
        if (cancelled) return;
        slot.innerHTML = '<p class="meta">Failed to load conditions</p>';
      });

    const onScroll = () => {
      try { state.scrollTop = slot.scrollTop || 0; persist(); } catch {}
    };
    slot.addEventListener('scroll', onScroll);

    return () => {
      cancelled = true;
      slot.removeEventListener('scroll', onScroll);
    };
  },
  unmount() {},
};
