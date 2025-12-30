import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';
import { HpTrackerApp } from '../miniapps/hp/app.js';

export function render(container) {
  setBreadcrumb('HP Tracker');
  setPageActionsEnabled({ canEdit: false, canDelete: false });

  if (!container) return;
  container.innerHTML = `
    <section class="page page--hp">
      <div id="hpRouteRoot"></div>
    </section>
  `;
  const root = document.getElementById('hpRouteRoot');
  const cleanup = HpTrackerApp.mount(root, { mountEl: root });
  return () => {
    try { if (typeof cleanup === 'function') cleanup(); } catch {}
    const outlet = document.getElementById('outlet');
    if (outlet) outlet.innerHTML = '';
  };
}
