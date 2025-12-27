import { renderWidgetsArea } from '../features/widgets.js';

export function render(container, ctx = {}) {
  if (!container) return;
  container.innerHTML = `
    <section>
      <h1>Dashboard</h1>
    </section>
    <div id="dashWidgetsHost"></div>
  `;
  const host = container.querySelector('#dashWidgetsHost');
  try { renderWidgetsArea(host, { surfaceId: 'dashboard', title: 'Widgets' }); } catch {}
}
