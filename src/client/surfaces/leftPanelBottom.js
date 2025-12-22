import { navigate } from '../lib/router.js';

export function mountLeftPanelBottom() {
  const root = document.getElementById('leftPanelBottomApp');
  if (!root) return;
  // Render a small Settings gear button that navigates to /settings
  root.innerHTML = `
    <div style="display:flex; justify-content:flex-end;">
      <button id="openSettings" class="chip" aria-label="Settings" title="Settings" style="padding:4px 8px;">
        ⚙︎ Settings
      </button>
    </div>
  `;
  const btn = root.querySelector('#openSettings');
  btn?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/settings');
  });
}

export function destroyLeftPanelBottom() {
  const root = document.getElementById('leftPanelBottomApp');
  if (root) root.innerHTML = '';
}
