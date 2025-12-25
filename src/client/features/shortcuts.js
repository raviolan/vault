// Global keyboard shortcuts for the entire app
//
// Shortcuts
// - Option+B: Toggle privacy blur overlay
// - Option+Q: Collapse all left sidebar sections except the current section
// - Option+D: Bookmark current page into Favorites (de-dupe by href)
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

    // Option+B — privacy blur overlay
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

function togglePrivacyBlur() {
  const id = 'dmPrivacyBlur';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '9999';
    el.style.backdropFilter = 'blur(10px)';
    el.style.webkitBackdropFilter = 'blur(10px)';
    try { el.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {}
    el.style.pointerEvents = 'auto';
    document.body.appendChild(el);
    return;
  }
  if (el.hasAttribute('hidden')) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
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
