// Right Panel Split: Notepad (top) + divider + To-Do (bottom)
// Keeps ratio persisted in user state and supports pointer + keyboard adjustments.
// Debug: set window.__DEBUG_RIGHT_SPLIT = true to enable logs at runtime.

const DEFAULT_RATIO = 0.40; // top fraction when unset

// Track which DOM we are currently bound to so we can re-bind when replaced
let bound = { root: null, handle: null, notepadPanel: null, todoPanel: null, notepadSlot: null, todoSlot: null };
let teardown = null; // removes listeners/observers for previous binding

const isDebug = () => (typeof window !== 'undefined' && !!window.__DEBUG_RIGHT_SPLIT);
// Lightweight ping to verify the correct module is loaded and live
try { if (typeof window !== 'undefined') { window.__DMV_SPLIT_PING__ = () => console.log('[split] ping', { loaded: true, t: Date.now() }); } } catch {}

export function initRightPanelSplit({ getUserState, patchUserState }) {
  // Query DOM fresh every time; do not mark installed if anything is missing
  const root = document.getElementById('rightDrawer');
  const notepadPanel = root?.querySelector(".right-panel[data-panel='notepad']");
  const todoPanel = root?.querySelector(".right-panel[data-panel='todo']");
  const notepadSlot = root?.querySelector('#rightNotepadSlot');
  const todoSlot = root?.querySelector('#rightTodoSlot');
  const handle = root?.querySelector('#rightSplitHandle');
  if (!root || !notepadPanel || !todoPanel || !notepadSlot || !todoSlot || !handle) {
    // If previously bound, tear down so we don't fight or leak listeners
    if (typeof teardown === 'function') {
      try { teardown(); } catch {}
      teardown = null;
    }
    bound = { root: null, handle: null, notepadPanel: null, todoPanel: null, notepadSlot: null, todoSlot: null };
    return;
  }

  // If we're already bound to this exact DOM, do nothing
  if (
    bound.root === root &&
    bound.handle === handle &&
    bound.notepadPanel === notepadPanel &&
    bound.todoPanel === todoPanel &&
    bound.notepadSlot === notepadSlot &&
    bound.todoSlot === todoSlot
  ) {
    return;
  }

  // If previously bound to different DOM, tear it down cleanly
  if (typeof teardown === 'function') {
    try { teardown(); } catch {}
    teardown = null;
  }

  const MIN_TOP = 160; // Notepad min px
  const MIN_BOTTOM = 220; // To-Do min px

  function readRatio() {
    const st = (typeof getUserState === 'function' ? getUserState() : {}) || {};
    const raw = st.rightSplitRatio;
    if (raw === undefined || raw === null) return DEFAULT_RATIO;
    const r = Number(raw);
    if (!Number.isFinite(r)) return DEFAULT_RATIO;
    return Math.max(0.05, Math.min(0.95, r));
  }

  function persistRatio(r) {
    try { if (typeof patchUserState === 'function') patchUserState({ rightSplitRatio: r }); } catch {}
  }

  // Measure the split region: panels + divider only (exclude any header above)
  function measureSplitRegion() {
    const topRect = notepadPanel.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const splitTop = topRect.top;
    // Prefer the drawer root for split bottom to avoid content-driven heights
    const splitBottom = rootRect.bottom;
    const regionH = Math.max(0, splitBottom - splitTop);
    const handleH = (handle.getBoundingClientRect().height || handle.offsetHeight || 10);
    const availableH = Math.max(0, regionH - handleH);
    // Measure chrome as the top gap between the panel and the slot
    const slotRect = notepadSlot.getBoundingClientRect();
    const chromeH = Math.max(0, Math.round(slotRect.top - topRect.top));
    // If the total available height cannot satisfy both MIN_TOP and MIN_BOTTOM,
    // relax the bottom minimum to a small fallback so dragging remains responsive.
    const FALLBACK_MIN_BOTTOM = 60;
    const enoughSpace = availableH >= (MIN_TOP + MIN_BOTTOM);
    const minBottomForCalc = enoughSpace ? MIN_BOTTOM : FALLBACK_MIN_BOTTOM;
    const maxTopH = Math.max(MIN_TOP, availableH - minBottomForCalc);
    return { splitTop, splitBottom, regionH, handleH, availableH, chromeH, maxTopH };
  }

  // Stable slot height applier; compare against DOM to avoid stale caches
  const setSlotHeight = (h) => {
    const v = Math.max(60, Math.round(h));
    const next = `${v}px`;
    if (notepadSlot.style.height !== next) {
      notepadSlot.style.height = next;
    }
  };

  // Drag/resize coordination flags used by RO and drag lifecycle
  let dragging = false;
  let applying = false; // suppress RO reactions while we apply heights
  let suppressRO = false; // block RO-driven apply while a drag session is active or settling

  // Compute and apply heights given a desired ratio (0..1) using split-region metrics
  function applyFromRatio(r) {
    if (dragging) {
      if (isDebug()) { console.warn('[split] applyFromRatio blocked during drag'); console.trace(); }
      return;
    }
    applying = true;
    suppressRO = true;
    const m = measureSplitRegion();
    let topH = Math.round(r * m.availableH);
    topH = Math.max(MIN_TOP, Math.min(m.maxTopH, topH));
    const chrome = Number.isFinite(m.chromeH) ? m.chromeH : 0;
    const slotH = Math.max(60, topH - chrome);
    setSlotHeight(slotH);
    requestAnimationFrame(() => { applying = false; suppressRO = false; });
  }

  // Initial apply
  applyFromRatio(readRatio());

  // Resize awareness: recompute on container resize, but avoid fighting active drags
  let ro;
  let roScheduled = false;
  try {
    const createRO = () => new ResizeObserver(() => {
      if (dragging || applying || suppressRO) return; // do not recompute while dragging, mid-apply, or suppressed
      if (roScheduled) return;
      roScheduled = true;
      requestAnimationFrame(() => {
        roScheduled = false;
        if (!dragging && !applying && !suppressRO) applyFromRatio(readRatio());
      });
    });
    ro = createRO();
    ro.observe(root);
  } catch {}

  // Drag handling (pointer first, fall back to mouse/touch). Add listeners only during drag.
  let frame = null;
  let lastY = 0;
  // Drag context measured once on pointerdown
  let ctx = null; // { splitTop, availableH, handleH, grabOffset, chromeH, maxTopH }
  let activeMode = 'none'; // 'pointer' | 'mouse' | 'touch'
  let lastRatio = null;
  // Debug-only: track external inline height mutations during drag
  let lastInline = null;

  try { handle.style.touchAction = 'none'; } catch {}
  

  const moveCompute = () => {
    if (!ctx) return;
    // Use only cached measurements captured on pointerdown.
    // Preserve grabOffset so the divider stays anchored to the click point.
    const desiredHandleTop = lastY - ctx.grabOffset;
    // Recompute current splitTop from the notepad panel's live position to avoid scroll drift
    const currentTopRect = notepadPanel.getBoundingClientRect();
    const splitTopNow = currentTopRect.top;
    let rawTopH = desiredHandleTop - splitTopNow;
    const minTop = MIN_TOP;
    // Dynamically recompute the maximum top height using current drawer root metrics
    const rootRect = root.getBoundingClientRect();
    const splitBottomNow = rootRect.bottom;
    const regionHNow = Math.max(0, splitBottomNow - splitTopNow);
    const availableHNow = Math.max(0, regionHNow - ctx.handleH);
    const enoughSpaceNow = availableHNow >= (MIN_TOP + MIN_BOTTOM);
    const minBottomForCalcNow = enoughSpaceNow ? MIN_BOTTOM : 60;
    const maxTopNow = Math.max(MIN_TOP, availableHNow - minBottomForCalcNow);
    rawTopH = Math.max(minTop, Math.min(maxTopNow, rawTopH));
    // Update slot height accounting for panel chrome above the slot
    const chrome = Number.isFinite(ctx.chromeH) ? ctx.chromeH : 0;
    const slotH = Math.max(60, Math.round(rawTopH - chrome));
    if (isDebug() && lastInline !== null && notepadSlot.style.height !== lastInline) {
      console.warn('[split] slot height changed externally', { from: lastInline, to: notepadSlot.style.height });
      console.trace();
    }
    setSlotHeight(slotH);
    // Debug: occasionally report available space and clamp
    if (isDebug()) {
      moveCompute.__i = (moveCompute.__i || 0) + 1;
      if ((moveCompute.__i % 10) === 0) {
        console.log('[split] move', { rootH: rootRect.height, availableHNow, maxTopNow });
      }
    }
    // After our write, track the inline height we expect going forward
    lastInline = notepadSlot.style.height;
    // Update last ratio (clamped between 0..1)
    const r = availableHNow > 0 ? (rawTopH / availableHNow) : DEFAULT_RATIO;
    lastRatio = Math.max(0, Math.min(1, r));
  };

  const onMove = (ev) => {
    if (!dragging) return;
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    lastY = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; moveCompute(); });
    if (ev.cancelable) ev.preventDefault();
  };
  const onUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-right-split');
    // Remove move/up listeners for the active mode
    if (activeMode === 'pointer') {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('pointerup', onUp, { capture: true });
      document.removeEventListener('pointercancel', onUp, { capture: true });
    } else if (activeMode === 'mouse') {
      document.removeEventListener('mousemove', onMove, { capture: true });
      document.removeEventListener('mouseup', onUp, { capture: true });
    } else if (activeMode === 'touch') {
      document.removeEventListener('touchmove', onMove, { capture: true });
      document.removeEventListener('touchend', onUp, { capture: true });
      document.removeEventListener('touchcancel', onUp, { capture: true });
    }
    activeMode = 'none';

    // Persist the last computed ratio without re-measuring during cleanup.
    const toSave = (typeof lastRatio === 'number' && Number.isFinite(lastRatio))
      ? Math.max(0, Math.min(1, lastRatio))
      : DEFAULT_RATIO;
    // Temporarily suppress RO from re-applying while we settle to the final ratio
    suppressRO = true;
    // Re-apply using current measurements to avoid any transient jump
    applyFromRatio(toSave);
    persistRatio(toSave);
    // Clear suppression next frame so RO can resume after geometry stabilizes
    requestAnimationFrame(() => {
      suppressRO = false;
      // Reconnect RO after drag completes
      try {
        ro = new ResizeObserver(() => {
          if (dragging || applying || suppressRO) return;
          if (roScheduled) return;
          roScheduled = true;
          requestAnimationFrame(() => {
            roScheduled = false;
            if (!dragging && !applying && !suppressRO) applyFromRatio(readRatio());
          });
        });
        ro.observe(root);
      } catch {}
    });
    ctx = null;
  };

  const onDown = (ev) => {
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation?.();
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    // Pause RO during drag to avoid any external re-applies
    try { ro?.disconnect?.(); } catch {}
    suppressRO = true;
    dragging = true;
    lastY = e.clientY;
    
    // Snapshot measurements of the split region at drag start
    const m = measureSplitRegion();
    const handleRect = handle.getBoundingClientRect();
    // Preserve the exact click position within the handle (top-based)
    const grabOffset = e.clientY - handleRect.top;
    ctx = { ...m, grabOffset };
    if (isDebug()) {
      const rr = root.getBoundingClientRect();
      const tr = notepadPanel.getBoundingClientRect();
      console.log('[split] down', { rootH: rr.height, topTop: tr.top, rootBottom: rr.bottom, availableH: m.availableH, maxTopH: m.maxTopH });
    }
    // Debug-only: seed external mutation detector with starting inline height
    lastInline = notepadSlot.style.height;
    document.body.classList.add('dragging-right-split');
    if (ev.type === 'pointerdown') {
      activeMode = 'pointer';
      try { handle.setPointerCapture?.(ev.pointerId); } catch {}
      document.addEventListener('pointermove', onMove, { capture: true, passive: false });
      document.addEventListener('pointerup', onUp, { capture: true, once: true });
      document.addEventListener('pointercancel', onUp, { capture: true, once: true });
    } else if (ev.type === 'mousedown') {
      activeMode = 'mouse';
      document.addEventListener('mousemove', onMove, { capture: true });
      document.addEventListener('mouseup', onUp, { capture: true, once: true });
    } else if (ev.type === 'touchstart') {
      activeMode = 'touch';
      document.addEventListener('touchmove', onMove, { capture: true, passive: false });
      document.addEventListener('touchend', onUp, { capture: true, once: true });
      document.addEventListener('touchcancel', onUp, { capture: true, once: true });
    }
    // Compute once immediately so first frame reflects the grabbed position
    
    moveCompute();
  };

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
  if (supportsPointer) {
    handle.addEventListener('pointerdown', onDown);
  } else {
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

  // Optional debug hooks to confirm binding and event reachability after enabling debug at runtime
  try {
    if (isDebug()) {
      const visible = () => {
        try { return getComputedStyle(handle).display !== 'none' && getComputedStyle(handle).visibility !== 'hidden'; } catch { return true; }
      };
      console.log('[split] bound', {
        supportsPointer,
        handleVisible: visible(),
        handleRect: (() => { try { const r = handle.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; } catch { return null; } })(),
        rootHidden: root.hasAttribute('hidden')
      });
      const dbg = (ev) => { if (isDebug()) console.log('[split] handle', ev.type, { pointerType: ev.pointerType, buttons: ev.buttons, touches: ev.touches?.length }); };
      handle.addEventListener('pointerdown', dbg, { capture: true });
      handle.addEventListener('mousedown', dbg, { capture: true });
      handle.addEventListener('touchstart', dbg, { capture: true });
    }
  } catch {}

  // Keyboard nudge
  let keyTimer = null;
  const onKeyDown = (e) => {
    const key = String(e.key || '').toLowerCase();
    if (key !== 'arrowup' && key !== 'arrowdown') return;
    e.preventDefault();
    const cur = readRatio();
    const delta = key === 'arrowup' ? 0.02 : -0.02;
    const next = Math.max(0.05, Math.min(0.95, cur + delta));
    applyFromRatio(next);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => persistRatio(next), 200);
  };
  handle.addEventListener('keydown', onKeyDown);

  // Record what DOM we are bound to now
  bound = { root, handle, notepadPanel, todoPanel, notepadSlot, todoSlot };

  // Provide teardown that cleanly removes listeners/observers for this binding
  teardown = () => {
    try { document.body.classList.remove('dragging-right-split'); } catch {}
    suppressRO = false;
    // Stop active drag listeners
    if (activeMode === 'pointer') {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('pointerup', onUp, { capture: true });
      document.removeEventListener('pointercancel', onUp, { capture: true });
    } else if (activeMode === 'mouse') {
      document.removeEventListener('mousemove', onMove, { capture: true });
      document.removeEventListener('mouseup', onUp, { capture: true });
    } else if (activeMode === 'touch') {
      document.removeEventListener('touchmove', onMove, { capture: true });
      document.removeEventListener('touchend', onUp, { capture: true });
      document.removeEventListener('touchcancel', onUp, { capture: true });
    }
    activeMode = 'none';
    dragging = false;
    // Remove start listeners
    if (supportsPointer) {
      handle.removeEventListener('pointerdown', onDown);
    } else {
      handle.removeEventListener('mousedown', onDown);
      handle.removeEventListener('touchstart', onDown);
    }
    handle.removeEventListener('keydown', onKeyDown);
    // Cancel any scheduled rAF
    try { if (frame) cancelAnimationFrame(frame); } catch {}
    frame = null;
    // Disconnect ResizeObserver
    try { ro?.disconnect?.(); } catch {}
    ro = null;
    roScheduled = false;
  };
}
