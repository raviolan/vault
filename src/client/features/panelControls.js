import { $, $$ } from '../lib/dom.js';
import { getState, updateState } from '../lib/state.js';

const MIN_LEFT = 220;
const MAX_LEFT = 520;
const MIN_RIGHT = 260;
const MAX_RIGHT = 620;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function initPanels() {
  const st = getState();
  // Apply saved widths
  if (Number.isFinite(st.leftPanelWidth)) document.documentElement.style.setProperty('--left-w', `${clamp(st.leftPanelWidth, MIN_LEFT, MAX_LEFT)}px`);
  if (Number.isFinite(st.rightPanelWidth)) document.documentElement.style.setProperty('--right-w', `${clamp(st.rightPanelWidth, MIN_RIGHT, MAX_RIGHT)}px`);

  // Apply collapsed classes
  if (st.leftCollapsed) document.body.classList.add('left-collapsed');
  if (st.rightCollapsed) document.body.classList.add('drawer-collapsed');

  // Rename hide buttons to "Close" (labels only)
  const leftToggle = $('#leftDrawerToggle');
  const rightToggle = $('#rightDrawerToggle');
  if (leftToggle) leftToggle.textContent = 'Close';
  if (rightToggle) rightToggle.textContent = 'Close';

  // Resizers
  const leftResizer = $('.resizer-left');
  if (leftResizer) bindResizer(leftResizer, 'left');
  const rightResizer = $('.resizer-right');
  if (rightResizer) bindResizer(rightResizer, 'right');

  // Close/open behavior augments
  if (leftToggle) leftToggle.addEventListener('click', () => toggleLeft());
  if (rightToggle) rightToggle.addEventListener('click', () => toggleRight());

  const leftTab = $('.left-drawer-tab');
  const rightTab = $('.drawer-tab');
  if (leftTab) {
    leftTab.hidden = false; // CSS can hide when not collapsed
    leftTab.addEventListener('click', () => openLeft());
  }
  if (rightTab) {
    rightTab.hidden = false;
    rightTab.addEventListener('click', () => openRight());
  }

  // Option+Q toggles left .nav-details groups
  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const k = String(e.key || '').toLowerCase();
    if (k !== 'q') return;
    const target = e.target;
    const tag = (target?.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || (target?.isContentEditable);
    if (isInput) return;
    const groups = $$('.left .nav-details');
    if (!groups.length) return;
    const openCount = groups.filter(d => d.open).length;
    const shouldClose = openCount >= Math.ceil(groups.length / 2);
    groups.forEach(d => { d.open = !shouldClose; });
    updateState({ leftSectionsCollapsed: shouldClose });
  });

  // Apply leftSectionsCollapsed on boot
  try {
    if (st.leftSectionsCollapsed) {
      const groups = $$('.left .nav-details');
      groups.forEach(d => { d.open = false; });
    }
  } catch {}
}

function bindResizer(el, side) {
  // Make dragging reliable on touch + pen
  try { el.style.touchAction = 'none'; } catch {}
  let startX = 0;
  let startW = 0;
  const onDown = (ev) => {
    ev.preventDefault();
    // Disable when collapsed
    if (side === 'left' && document.body.classList.contains('left-collapsed')) return;
    if (side === 'right' && document.body.classList.contains('drawer-collapsed')) return;
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    startX = e.clientX;
    const cs = getComputedStyle(document.documentElement);
    const cur = parseInt(cs.getPropertyValue(side === 'left' ? '--left-w' : '--right-w')) || (side === 'left' ? 300 : 340);
    startW = cur;
    if (ev.pointerId != null && el.setPointerCapture) {
      try { el.setPointerCapture(ev.pointerId); } catch {}
    }
    // Pointer events
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    // Fallback mouse/touch events
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp, { once: true });
    window.addEventListener('touchcancel', onUp, { once: true });
  };
  const onMove = (ev) => {
    if (ev.cancelable) ev.preventDefault();
    const e = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    const dx = e.clientX - startX;
    const next = side === 'left'
      ? clamp(startW + dx, MIN_LEFT, MAX_LEFT)
      : clamp(startW - dx, MIN_RIGHT, MAX_RIGHT);
    document.documentElement.style.setProperty(side === 'left' ? '--left-w' : '--right-w', `${next}px`);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
    window.removeEventListener('touchcancel', onUp);
    // Persist
    const cs = getComputedStyle(document.documentElement);
    const cur = parseInt(cs.getPropertyValue(side === 'left' ? '--left-w' : '--right-w')) || (side === 'left' ? 300 : 340);
    if (side === 'left') updateState({ leftPanelWidth: cur });
    else updateState({ rightPanelWidth: cur });
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('mousedown', onDown);
  el.addEventListener('touchstart', onDown, { passive: false });
}

function toggleLeft() {
  const nowCollapsed = !document.body.classList.contains('left-collapsed');
  if (nowCollapsed) {
    document.body.classList.add('left-collapsed');
    updateState({ leftCollapsed: true, leftPanelOpen: false });
  } else {
    openLeft();
  }
}
function openLeft() {
  document.body.classList.remove('left-collapsed');
  $('#leftDrawer')?.removeAttribute('hidden');
  $('#leftDrawerToggle')?.setAttribute('aria-expanded', 'true');
  updateState({ leftCollapsed: false, leftPanelOpen: true });
}

function toggleRight() {
  const nowCollapsed = !document.body.classList.contains('drawer-collapsed');
  if (nowCollapsed) {
    document.body.classList.add('drawer-collapsed');
    updateState({ rightCollapsed: true, rightPanelOpen: false });
  } else {
    openRight();
  }
}
function openRight() {
  document.body.classList.remove('drawer-collapsed');
  $('#rightDrawer')?.removeAttribute('hidden');
  $('#rightDrawerToggle')?.setAttribute('aria-expanded', 'true');
  updateState({ rightCollapsed: false, rightPanelOpen: true });
}
