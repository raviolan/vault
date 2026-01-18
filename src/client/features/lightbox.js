// Global image lightbox with delegated handling
// - Click any meaningful <img> to open a full-screen overlay
// - Matches Option+B privacy blur style (backdrop-filter: blur(10px))
// - Restores focus, locks scroll while open, closes on backdrop/close/Escape

let installed = false;

export function installGlobalLightbox() {
  if (installed) return;
  installed = true;

  const state = {
    root: null,
    imgEl: null,
    captionEl: null,
    closeBtn: null,
    openerEl: null,
    open: false,
  };

  function ensureRoot() {
    if (state.root) return state.root;
    const root = document.createElement('div');
    root.className = 'dmv-lightbox';
    root.id = 'dmvLightbox';
    root.setAttribute('aria-hidden', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'dmv-lightbox__backdrop';
    // Match Option+B blur tint if available
    try { backdrop.style.background = 'color-mix(in srgb, var(--bg) 55%, transparent)'; } catch {}
    backdrop.addEventListener('click', () => close());

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dmv-lightbox__close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => close());

    const fig = document.createElement('figure');
    fig.className = 'dmv-lightbox__figure';
    fig.setAttribute('role', 'dialog');
    fig.setAttribute('aria-modal', 'true');

    const img = document.createElement('img');
    img.className = 'dmv-lightbox__img';
    img.alt = '';

    const cap = document.createElement('figcaption');
    cap.className = 'dmv-lightbox__caption';
    cap.hidden = true;

    fig.appendChild(img);
    fig.appendChild(cap);
    root.appendChild(backdrop);
    root.appendChild(fig);
    root.appendChild(closeBtn);
    document.body.appendChild(root);

    state.root = root;
    state.imgEl = img;
    state.captionEl = cap;
    state.closeBtn = closeBtn;
    return root;
  }

  function isOptedOut(img) {
    if (!img) return true;
    if (img.closest('.no-lightbox')) return true;
    const attr = img.getAttribute('data-no-lightbox');
    if (attr && String(attr).toLowerCase() !== 'false') return true;
    return false;
  }

  function srcIsMeaningful(url) {
    if (!url) return false;
    try {
      const u = String(url).toLowerCase();
      if (u.startsWith('data:image/')) return true;
      return (/(\.png|\.jpg|\.jpeg|\.webp)([?#].*)?$/i).test(u);
    } catch { return false; }
  }

  function isUiIcon(img) {
    // Heuristic: very small images or images inside common control surfaces
    try {
      const rect = img.getBoundingClientRect();
      if (rect.width <= 32 && rect.height <= 32) return true;
    } catch {}
    const uiAncestor = img.closest('.toolbar, .chip, .button, button, .nav, nav, .modal, .headerMediaControls, .headerMediaProfileControls, aside.left, aside.right, .right-panel, .right-drawer, .top');
    return !!uiAncestor;
  }

  function findBackgroundImageSrc(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundImage || '';
    const m = bg.match(/url\(("|'|)([^"')]+)\1\)/i);
    if (m && m[2]) return m[2];
    return null;
  }

  function open({ src, caption, opener }) {
    ensureRoot();
    if (!src) return;
    state.openerEl = opener || null;
    state.imgEl.src = src;
    const cap = String(caption || '').trim();
    if (cap) { state.captionEl.textContent = cap; state.captionEl.hidden = false; }
    else { state.captionEl.textContent = ''; state.captionEl.hidden = true; }

    state.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dmv-lightbox-open');
    state.open = true;
    // Focus close button for accessibility
    try { state.closeBtn.focus(); } catch {}
  }

  function close() {
    if (!state.open) return;
    state.root?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dmv-lightbox-open');
    state.open = false;
    // Restore focus to opener if possible
    if (state.openerEl instanceof HTMLElement) {
      try { state.openerEl.focus(); } catch {}
    }
    state.openerEl = null;
  }

  // Click delegation (capture) — prioritize images
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return; // left-click only
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // don't hijack modified clicks
    if (state.open) return; // ignore while open

    const target = e.target;
    // 1) <img> handling
    let img = target?.closest?.('img');
    if (img instanceof HTMLImageElement) {
      if (isOptedOut(img)) return;
      if (isUiIcon(img)) return;
      const src = img.currentSrc || img.src || '';
      if (!srcIsMeaningful(src)) return;
      // If image is inside a link, intercept only when clicking the image
      const link = img.closest('a[href]');
      if (link) { e.preventDefault(); e.stopPropagation(); }
      open({ src, caption: (img.alt || '').trim() || '', opener: img });
      return;
    }

    // 2) Background images on known media blocks (e.g., header cover)
    //    Only when clicking directly on the media surface
    const bgEl = target?.closest?.('.headerMedia .cover, .landing-card-image, .landing-hero, .page-hero');
    if (bgEl) {
      if (bgEl.closest('.no-lightbox') || bgEl.closest('[data-no-lightbox="true"]')) return;
      const src = findBackgroundImageSrc(bgEl);
      if (src && srcIsMeaningful(src)) {
        e.preventDefault();
        e.stopPropagation();
        open({ src, caption: '', opener: bgEl });
        return;
      }
    }
  }, true);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (!state.open) return;
    const key = String(e.key || '').toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      close();
    }
  }, true);

  // Expose for debugging if needed
  // window.__dmvLightbox = { open, close };
}
