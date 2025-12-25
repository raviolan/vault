// Right Panel Split: Notepad (top) + divider + To-Do (bottom)
// Keeps ratio persisted in user state and supports pointer + keyboard adjustments.

let installed = false;

export function initRightPanelSplit({ getUserState, patchUserState }) {
  if (installed) return;
  installed = true;

  const root = document.getElementById('rightDrawer');
  const notepadPanel = root?.querySelector(".right-panel[data-panel='notepad']");
  const todoPanel = root?.querySelector(".right-panel[data-panel='todo']");
  const notepadSlot = root?.querySelector('#rightNotepadSlot');
  const todoSlot = root?.querySelector('#rightTodoSlot');
  const handle = root?.querySelector('#rightSplitHandle');
  if (!root || !notepadPanel || !todoPanel || !notepadSlot || !todoSlot || !handle) return;

  const MIN_TOP = 160; // Notepad min px
  const MIN_BOTTOM = 220; // To-Do min px

  function readRatio() {
    const st = (typeof getUserState === 'function' ? getUserState() : {}) || {};
    const r = Number(st.rightSplitRatio);
    if (!Number.isFinite(r)) return 0.4;
    return Math.max(0.05, Math.min(0.95, r));
  }

  function persistRatio(r) {
    try { if (typeof patchUserState === 'function') patchUserState({ rightSplitRatio: r }); } catch {}
  }

  // Compute and apply heights given a desired ratio (0..1)
  function applyFromRatio(r) {
    const rect = root.getBoundingClientRect();
    const totalH = rect.height;
    const handleH = handle.offsetHeight || 10;
    const available = Math.max(0, totalH - handleH);
    // Target top region height (includes notepad header + slot)
    let topH = Math.round(r * available);
    // Enforce min sizes for both regions
    const maxTop = Math.max(MIN_TOP, available - MIN_BOTTOM);
    topH = Math.max(MIN_TOP, Math.min(maxTop, topH));

    // Subtract header height from slot height so textarea fills correctly
    const header = notepadPanel.querySelector('h3.meta');
    const headerH = header ? header.offsetHeight : 0;
    const slotH = Math.max(60, topH - headerH);
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
  let startRect = null;
  let startHeaderH = 0;
  let startHandleH = 10;
  let startAvailable = 0;
  let startMaxTop = 0;
  let activeMode = 'none'; // 'pointer' | 'mouse' | 'touch'

  try { handle.style.touchAction = 'none'; } catch {}

  const moveCompute = () => {
    // Compute desired top height based on pointer Y relative to top of root
    // Use only cached measurements to avoid layout reads during drag frames
    let rawTop = lastY - startRect.top; // pointer relative to top of container
    // Clamp to min/max respecting both regions using precomputed bounds
    rawTop = Math.max(MIN_TOP, Math.min(startMaxTop, rawTop));
    // Apply slot height (subtract header)
    const slotH = Math.max(60, Math.round(rawTop - startHeaderH));
    notepadSlot.style.height = `${slotH}px`;
  };

  const onMove = (ev) => {
    if (!dragging) return;
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    lastY = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; moveCompute(); });
    if (ev.cancelable) ev.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging-right-split');
    // Remove move/up listeners for the active mode
    if (activeMode === 'pointer') {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    } else if (activeMode === 'mouse') {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    } else if (activeMode === 'touch') {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    }
    activeMode = 'none';

    const rect = root.getBoundingClientRect();
    const handleH = handle.offsetHeight || 10;
    const totalH = rect.height;
    const available = Math.max(0, totalH - handleH);
    const header = notepadPanel.querySelector('h3.meta');
    const headerH = header ? header.offsetHeight : 0;
    const slotH = parseInt((notepadSlot.style.height || '0').replace(/px$/, ''), 10) || 0;
    const topH = Math.max(0, slotH + headerH);
    const ratio = available > 0 ? Math.max(0, Math.min(1, topH / available)) : 0.4;
    persistRatio(ratio);
  };

  const onDown = (ev) => {
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    dragging = true;
    lastY = e.clientY;
    startRect = root.getBoundingClientRect();
    const header = notepadPanel.querySelector('h3.meta');
    startHeaderH = header ? header.offsetHeight : 0;
    startHandleH = handle.offsetHeight || 10;
    const totalH = startRect.height;
    startAvailable = Math.max(0, totalH - startHandleH);
    startMaxTop = Math.max(MIN_TOP, startAvailable - MIN_BOTTOM);
    document.body.classList.add('dragging-right-split');
    if (ev.type === 'pointerdown') {
      activeMode = 'pointer';
      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    } else if (ev.type === 'mousedown') {
      activeMode = 'mouse';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp, { once: true });
    } else if (ev.type === 'touchstart') {
      activeMode = 'touch';
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp, { once: true });
      window.addEventListener('touchcancel', onUp, { once: true });
    }
    if (ev.cancelable) ev.preventDefault();
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
  handle.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    if (key !== 'arrowup' && key !== 'arrowdown') return;
    e.preventDefault();
    const cur = readRatio();
    const delta = key === 'arrowup' ? 0.02 : -0.02;
    const next = Math.max(0.05, Math.min(0.95, cur + delta));
    applyFromRatio(next);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => persistRatio(next), 200);
  });
}
