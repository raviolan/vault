import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { SettingsApp } from '../miniapps/settings/app.js';

export function render(container) {
  setBreadcrumb('Settings');
  setPageActionsEnabled({ canEdit: false, canDelete: false });

  if (!container) return;
  container.innerHTML = `
    <section class="page">
      <div id="settingsRouteRoot"></div>
    </section>
  `;
  const root = document.getElementById('settingsRouteRoot');
  const cleanup = SettingsApp.mount(root, {});
  return () => {
    try { if (typeof cleanup === 'function') cleanup(); } catch {}
    // Clear content when leaving
    const outlet = document.getElementById('outlet');
    if (outlet) outlet.innerHTML = '';
  };
}

