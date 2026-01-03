// Global keyboard shortcuts for the entire app
import { getState } from '../lib/state.js';
//
// Shortcuts
// - Option+B: Privacy overlay — show header image fullscreen (fallback to blur)
// - Option+Q: Collapse all left sidebar sections except the current section
// - Option+D: Bookmark current page into Favorites (de-dupe by href)
// - Option+E: Collapse/expand all subsections on current page
// - Option+A: Toggle collapse/expand all LEFT SIDEBAR subsections (leave top-level unchanged)
// - Ctrl+Enter: Save and exit editing (flush debounced saves)

let installed = false;

export function initGlobalShortcuts({ navigate, patchUserState, getUserState }) {
  if (installed) return;
  installed = true;

  document.addEventListener('keydown', async (e) => {
    if (e.repeat) return;

    // Prefer physical key location for letters since Option/Alt modifies e.key on macOS
    const code = String(e.code || '');
    const key = String(e.key || '').toLowerCase();

    // Escape — close privacy overlay if open
    if (!e.altKey && !e.metaKey && !e.ctrlKey && (key === 'escape' || code === 'Escape')) {
      const ov = document.getElementById('dmPrivacyBlur');
      if (ov && ov.style.display !== 'none') {
        e.preventDefault();
        ov.style.display = 'none';
        return;
      }
    }

    // Option+B — privacy overlay: show header image fullscreen (fallback to blur)
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyB' || key === 'b')) {
      e.preventDefault();
      togglePrivacyBlur();
      return;
    }

    // Option+Q — collapse left sections except current
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyQ' || key === 'q')) {
      e.preventDefault();
      collapseLeftSectionsExceptActive();
      return;
    }

    // Option+D — bookmark current page into Favorites
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyD' || key === 'd')) {
      e.preventDefault();
      try { await addCurrentToFavorites({ patchUserState, getUserState }); } catch {}
      return;
    }

    // Option+W — expand all left sections
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyW' || key === 'w')) {
      e.preventDefault();
      expandAllLeftSections();
      return;
    }

    // Option+E — toggle all subsections on current page
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyE' || key === 'e')) {
      // Ignore while typing in input/textarea/contenteditable
      const ae = document.activeElement;
      const isTyping = !!(ae && (
        ae.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') ||
        (ae instanceof HTMLInputElement) ||
        (ae instanceof HTMLTextAreaElement) ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ));
      if (isTyping) return;
      e.preventDefault();
      try { await toggleAllSubsections(); } catch (err) { console.error('toggleAllSubsections failed', err); }
      return;
    }

    // Option+A — toggle all LEFT SIDEBAR subsections (not top-level)
    if (e.altKey && !e.metaKey && !e.ctrlKey && (code === 'KeyA' || key === 'a')) {
      // Ignore while typing in input/textarea/contenteditable
      const ae = document.activeElement;
      const isTyping = !!(ae && (
        ae.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') ||
        (ae instanceof HTMLInputElement) ||
        (ae instanceof HTMLTextAreaElement) ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ));
      if (isTyping) return;
      e.preventDefault();
      toggleLeftSubsectionDetails();
      return;
    }

    // Ctrl+Enter — save + exit editing everywhere
    if (e.ctrlKey && !e.metaKey && (code === 'Enter' || key === 'enter')) {
      e.preventDefault();
      try {
        const mod = await import('../routes/pages.js');
        if (typeof mod.saveAndExitEditing === 'function') {
          await mod.saveAndExitEditing();
        }
      } catch {}
      return;
    }
  }, true);
}

async function toggleAllSubsections() {
  // Lazy-load dependencies to avoid heavy upfront costs/cycles
  const [{ getCurrentPageBlocks, updateCurrentBlocks }, { debouncePatch }] = await Promise.all([
    import('../lib/pageStore.js'),
    import('../blocks/edit/state.js'),
  ]);

  const blocks = getCurrentPageBlocks();
  if (!Array.isArray(blocks) || !blocks.length) return;

  // Build quick lookup maps
  const byId = new Map(blocks.map(b => [String(b.id), b]));
  const parseProps = (b) => {
    const raw = b?.propsJson;
    if (!raw) return {};
    if (typeof raw === 'object') return raw || {};
    try { return JSON.parse(String(raw)); } catch { return {}; }
  };

  // Identify subsections: type==='section' and parent is a section OR level>1
  const subsections = [];
  for (const b of blocks) {
    if (b?.type !== 'section') continue;
    const props = parseProps(b);
    const level = Number(props.level || 0);
    const parent = b.parentId ? byId.get(String(b.parentId)) : null;
    const parentIsSection = !!(parent && parent.type === 'section');
    const isSub = parentIsSection || (Number.isFinite(level) && level > 1);
    if (isSub) subsections.push({ block: b, props });
  }
  if (!subsections.length) return;

  // Determine target collapsed state: if any expanded -> collapse all, else expand all
  const expandedExists = subsections.some(x => !x.props?.collapsed);
  const targetCollapsed = expandedExists ? true : false;

  // Optimistically update local store so UI responds immediately
  const idSet = new Set(subsections.map(x => String(x.block.id)));
  updateCurrentBlocks((b) => {
    if (!idSet.has(String(b.id))) return b;
    const oldProps = parseProps(b);
    const nextProps = { ...oldProps, collapsed: targetCollapsed };
    return { ...b, propsJson: JSON.stringify(nextProps) };
  });

  // Update DOM immediately to avoid jank or requiring a full re-render
  for (const { block } of subsections) {
    try {
      const root = document.querySelector(`[data-block-id="${CSS.escape(String(block.id))}"]`);
      if (!root) continue;
      const header = root.querySelector?.('.section-header');
      const kidsWrap = root.querySelector?.('.section-children');
      const toggle = root.querySelector?.('.section-toggle');
      if (header) header.dataset.collapsed = targetCollapsed ? '1' : '0';
      if (kidsWrap && kidsWrap instanceof HTMLElement) kidsWrap.style.display = targetCollapsed ? 'none' : '';
      if (toggle && toggle instanceof HTMLElement) {
        toggle.textContent = targetCollapsed ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', targetCollapsed ? 'false' : 'true');
      }
    } catch {}
  }

  // Queue debounced patches for each affected block (do not await)
  for (const { block, props } of subsections) {
    const next = { ...props, collapsed: targetCollapsed };
    try { debouncePatch(block.id, { props: next }); } catch {}
  }
}

function togglePrivacyBlur() {
  const id = 'dmPrivacyBlur';
  let el = document.getElementById(id);

  // Always prefer the index (dashboard) header image from state
  const getIndexHeaderImageSrc = () => {
    try {
      const st = getState();
      const surf = st?.surfaceMediaV1?.surfaces?.dashboard || null;
      const header = surf?.header || null;
      const path = header?.path || null;
      if (path) return `/media/${path}`;
    } catch {}
    return null;
  };

  if (!el) {
    // Create overlay on first toggle
    el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '9999';
    el.style.pointerEvents = 'auto';

    // Try to render the index header image fullscreen; otherwise fall back to blur
    const src = getIndexHeaderImageSrc();
    if (src) {
      // Fullscreen image presentation (separate from lightbox)
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      // Soft tint backdrop without blur (kept separate from lightbox styles)
      try { el.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {
        el.style.background = 'rgba(0,0,0,0.18)';
      }

      const fig = document.createElement('figure');
      fig.style.margin = '0';
      fig.style.maxWidth = '92vw';
      fig.style.maxHeight = '90vh';

      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      img.style.display = 'block';
      img.style.maxWidth = '92vw';
      img.style.maxHeight = '90vh';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.objectFit = 'contain';
      img.style.borderRadius = '10px';
      img.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';

      fig.appendChild(img);
      el.appendChild(fig);
    } else {
      // Fallback: previous blur overlay behavior
      el.style.backdropFilter = 'blur(10px)';
      el.style.webkitBackdropFilter = 'blur(10px)';
      try { el.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {}
    }

    // Click-to-close behavior (attach once; capture to prevent lightbox/openers)
    if (!el.dataset?.clickCloseBound) {
      el.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { el.style.display = 'none'; } catch {} }, true);
      el.dataset.clickCloseBound = '1';
    }

    document.body.appendChild(el);
    return;
  }

  // Toggle visibility; when showing, refresh to index header image if available
  if (el.style.display === 'none') {
    el.style.display = '';
    const src = getIndexHeaderImageSrc();
    // Clear previous content/styles we control
    while (el.firstChild) el.removeChild(el.firstChild);
    el.style.backdropFilter = '';
    el.style.webkitBackdropFilter = '';
    if (src) {
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      try { el.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {
        el.style.background = 'rgba(0,0,0,0.18)';
      }
      const fig = document.createElement('figure');
      fig.style.margin = '0';
      fig.style.maxWidth = '92vw';
      fig.style.maxHeight = '90vh';
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      img.style.display = 'block';
      img.style.maxWidth = '92vw';
      img.style.maxHeight = '90vh';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.objectFit = 'contain';
      img.style.borderRadius = '10px';
      img.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
      fig.appendChild(img);
      el.appendChild(fig);
    } else {
      // No header: use blur fallback
      el.style.display = '';
      try { el.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {}
      el.style.backdropFilter = 'blur(10px)';
      el.style.webkitBackdropFilter = 'blur(10px)';
    }
  } else {
    el.style.display = 'none';
  }
}

function collapseLeftSectionsExceptActive() {
  const nav = document.querySelector('aside.left nav.nav');
  if (!nav) return;
  // Find active link if any; fallback to matching current pathname href
  let active = nav.querySelector('a[aria-current="page"], a.is-active');
  if (!active) {
    const path = window.location.pathname;
    const links = Array.from(nav.querySelectorAll('a[href]'));
    active = links.find(a => (a.getAttribute('href') || '') === path) || null;
  }
  const keepOpen = active?.closest('details[data-section], details.nav-details');
  const all = nav.querySelectorAll('details[data-section], details.nav-details');
  all.forEach((d) => { d.open = false; });
  if (keepOpen instanceof HTMLDetailsElement) keepOpen.open = true;
}

function expandAllLeftSections() {
  const nav = document.querySelector('aside.left nav.nav');
  if (!nav) return;
  const all = nav.querySelectorAll('details[data-section], details.nav-details');
  all.forEach((d) => { d.open = true; });
}

// Toggle all nested <details> elements inside each top-level left sidebar section.
// Top-level sections are <details.nav-details>[data-section]. Subsections are nested
// <details.nav-details> descendants without a [data-section] attribute.
function toggleLeftSubsectionDetails() {
  const nav = document.querySelector('aside.left nav.nav');
  if (!nav) return;
  // Collect all nested details under each top-level section
  const topLevel = Array.from(nav.querySelectorAll('details.nav-details[data-section]'));
  const nested = [];
  for (const top of topLevel) {
    const kids = top.querySelectorAll('details.nav-details:not([data-section])');
    kids.forEach(d => nested.push(d));
  }
  if (!nested.length) return;
  // Determine target: if any is open, collapse all; otherwise expand all
  const anyOpen = nested.some(d => d.open);
  const nextOpen = !anyOpen;
  nested.forEach(d => { d.open = nextOpen; });
}

async function addCurrentToFavorites({ patchUserState, getUserState }) {
  const href = window.location.pathname + window.location.search;
  let title = '';
  title = document.querySelector('main h1')?.textContent?.trim() || title;
  title = title || document.querySelector('[data-page-title]')?.textContent?.trim() || '';
  title = title || document.title || href;
  title = String(title).trim().slice(0, 120);

  const st = getUserState() || {};
  const prev = Array.isArray(st.favorites) ? st.favorites.slice() : [];
  if (prev.some(x => x && x.href === href)) return; // already bookmarked
  const next = [...prev, { href, title }];
  patchUserState({ favorites: next });

  // Re-render Favorites UI if available
  try { await import('./favorites.js').then(m => m.renderFavorites()); } catch {}
}
