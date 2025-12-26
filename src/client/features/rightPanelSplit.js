// Right Panel Split: Notepad (top) + divider + To-Do (bottom)
// Keeps ratio persisted in user state and supports pointer + keyboard adjustments.
// Debug: set window.__DEBUG_RIGHT_SPLIT = true to enable logs at runtime.

const DEFAULT_RATIO = 0.40; // top fraction when unset

// Track which DOM we are currently bound to so we can re-bind when replaced
let bound = { root: null, handle: null, notepadPanel: null, todoPanel: null, notepadSlot: null, todoSlot: null };
let teardown = null; // removes listeners/observers for previous binding

const isDebug = () => (typeof window !== 'undefined' && !!window.__DEBUG_RIGHT_SPLIT);

export function initRightPanelSplit({ getUserState, patchUserState }) {
  // Query DOM fresh every time; do not mark installed if anything is missing
  const root = document.getElementById('rightDrawer');
  const notepadPanel = root?.querySelector(".right-panel[data-panel='notepad']");
  const todoPanel = root?.querySelector(".right-panel[data-panel='todo']");
  const notepadSlot = root?.querySelector('#rightNotepadSlot');
  const todoSlot = root?.querySelector('#rightTodoSlot');
  const handle = root?.querySelector('#rightSplitHandle');
  if (!root || !notepadPanel || !todoPanel || !notepadSlot || !todoSlot || !handle) {
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[split:init]', { action: 'missing-dom', rootFound: !!root, handleFound: !!handle });
    }
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
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[split:init]', { action: 'already-bound', same: true, handle });
    }
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
    const bottomRect = todoPanel.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const splitTop = topRect.top;
    // Use the real container bottom so availableH reflects actual drawer height.
    // Fallback: ensure it is never smaller than rootRect.bottom.
    const splitContainer = handle.closest('.right-drawer-content') || root;
    const containerRect = splitContainer.getBoundingClientRect();
    const splitBottom = Math.max(containerRect.bottom, rootRect.bottom);
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

  // Compute and apply heights given a desired ratio (0..1) using split-region metrics
  function applyFromRatio(r) {
    const m = measureSplitRegion();
    let topH = Math.round(r * m.availableH);
    topH = Math.max(MIN_TOP, Math.min(m.maxTopH, topH));
    const chrome = Number.isFinite(m.chromeH) ? m.chromeH : 0;
    const slotH = Math.max(60, topH - chrome);
    notepadSlot.style.height = `${slotH}px`;
  }

  // Initial apply
  applyFromRatio(readRatio());

  // Drag/resize coordination flags used by RO and drag lifecycle
  let dragging = false;
  // Resize awareness: recompute on container resize, but avoid fighting active drags
  let ro;
  let roScheduled = false;
  try {
    ro = new ResizeObserver(() => {
      if (dragging) return; // do not recompute while dragging
      if (roScheduled) return;
      roScheduled = true;
      requestAnimationFrame(() => {
        roScheduled = false;
        if (!dragging) applyFromRatio(readRatio());
      });
    });
    ro.observe(root);
  } catch {}

  // Drag handling (pointer first, fall back to mouse/touch). Add listeners only during drag.
  let frame = null;
  let lastY = 0;
  // Drag context measured once on pointerdown
  let ctx = null; // { splitTop, availableH, handleH, grabOffset, chromeH, maxTopH }
  let activeMode = 'none'; // 'pointer' | 'mouse' | 'touch'
  let lastRatio = null;

  try { handle.style.touchAction = 'none'; } catch {}
  if (isDebug()) {
    // eslint-disable-next-line no-console
    console.log('[split:init]', { action: 'bound', rootFound: !!root, handleFound: !!handle, boundToThisHandle: true, handle });
  }

  const moveCompute = () => {
    if (!ctx) return;
    // Use only cached measurements captured on pointerdown.
    // Preserve grabOffset so the divider stays anchored to the click point.
    const desiredHandleTop = lastY - ctx.grabOffset;
    let rawTopH = desiredHandleTop - ctx.splitTop;
    const minTop = MIN_TOP;
    const maxTop = ctx.maxTopH;
    rawTopH = Math.max(minTop, Math.min(maxTop, rawTopH));
    // Update slot height accounting for panel chrome above the slot
    const chrome = Number.isFinite(ctx.chromeH) ? ctx.chromeH : 0;
    const slotH = Math.max(60, Math.round(rawTopH - chrome));
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log({ rawTopH, chromeH: ctx.chromeH, slotH, heightStr: `${slotH}px` });
      // eslint-disable-next-line no-console
      console.log('finite?', Number.isFinite(slotH));
      // eslint-disable-next-line no-console
      console.log('[split:clamp]', { minTop, maxTop, availableH: ctx.availableH });
    }
    notepadSlot.style.height = `${slotH}px`;
    // Update last ratio (clamped between 0..1)
    const r = ctx.availableH > 0 ? (rawTopH / ctx.availableH) : DEFAULT_RATIO;
    lastRatio = Math.max(0, Math.min(1, r));
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[split:move]', {
        clientY: lastY,
        grabOffset: ctx.grabOffset,
        splitTop: ctx.splitTop,
        desiredHandleTop,
        rawTopH,
        ratio: lastRatio,
      });
    }
  };

  let moveLogCount = 0;
  const onMove = (ev) => {
    if (!dragging) return;
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    lastY = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; moveCompute(); });
    if (ev.cancelable) ev.preventDefault();
    if (isDebug() && moveLogCount < 5) {
      // eslint-disable-next-line no-console
      console.log('[split:move:event]', { type: ev.type, clientY: e.clientY, dragging });
      moveLogCount += 1;
    }
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
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[split:end]', { reason: ev?.type || 'end', ratio: toSave, lastRatio });
    }
    persistRatio(toSave);
    ctx = null;
  };

  const onDown = (ev) => {
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation?.();
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    dragging = true;
    lastY = e.clientY;
    if (isDebug()) {
      const handleRect = handle.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const splitContainer = handle.closest('.right-drawer-content') || root;
      const containerRect = splitContainer.getBoundingClientRect();
      const topRect = notepadPanel.getBoundingClientRect();
      const bottomRect = todoPanel.getBoundingClientRect();
      const m = measureSplitRegion();
      // eslint-disable-next-line no-console
      console.log('[split:down]', {
        type: ev.type,
        pointerId: ev.pointerId,
        pointerType: ev.pointerType,
        buttons: ev.buttons,
        target: ev.target,
        currentTarget: ev.currentTarget,
        regionH: m.regionH,
        availableH: m.availableH,
        maxTopH: m.maxTopH,
        MIN_TOP,
        MIN_BOTTOM,
        topRectTop: Math.round(topRect.top),
        containerBottom: Math.round(containerRect.bottom),
        rootBottom: Math.round(rootRect.bottom),
        bottomRectBottom: Math.round(bottomRect.bottom),
        handleRect: { top: Math.round(handleRect.top), left: Math.round(handleRect.left), width: Math.round(handleRect.width), height: Math.round(handleRect.height) },
        rootRect: { top: Math.round(rootRect.top), left: Math.round(rootRect.left), width: Math.round(rootRect.width), height: Math.round(rootRect.height) },
      });
    }
    // Snapshot measurements of the split region at drag start
    const m = measureSplitRegion();
    const handleRect = handle.getBoundingClientRect();
    // Preserve the exact click position within the handle (top-based)
    const grabOffset = e.clientY - handleRect.top;
    ctx = { ...m, grabOffset };
    document.body.classList.add('dragging-right-split');
    moveLogCount = 0;
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
    if (isDebug() && ctx) {
      const desiredHandleTop = lastY - ctx.grabOffset;
      const rawTopH = desiredHandleTop - ctx.splitTop;
      const r = ctx.availableH > 0 ? (rawTopH / ctx.availableH) : DEFAULT_RATIO;
      const computedSlotH = Math.max(60, Math.round(rawTopH - ctx.chromeH));
      const currentSlotH = Math.round(notepadSlot.getBoundingClientRect().height);
      // eslint-disable-next-line no-console
      console.log('[split:start]', {
        clientY: lastY,
        grabOffset: ctx.grabOffset,
        splitTop: ctx.splitTop,
        desiredHandleTop,
        rawTopH,
        ratio: Math.max(0, Math.min(1, r)),
        chromeH: ctx.chromeH,
        currentSlotH,
        computedSlotH,
      });
    }
    moveCompute();
  };

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
  if (supportsPointer) {
    handle.addEventListener('pointerdown', onDown);
  } else {
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

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
