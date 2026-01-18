import { $, escapeHtml } from '../lib/dom.js';
import { setBreadcrumb, setPageActionsEnabled } from '../lib/ui.js';

export function renderPlaceholder(title) {
  setBreadcrumb(title);
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = $('#outlet');
  if (!outlet) return;
  outlet.innerHTML = `
    <section>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Placeholder route. We’ll wire this module up cleanly as a mini-app.</p>
    </section>
  `;
}

export function renderNotFound() {
  setBreadcrumb('Not found');
  setPageActionsEnabled({ canEdit: false, canDelete: false });
  const outlet = $('#outlet');
  if (!outlet) return;
  outlet.innerHTML = `
    <section>
      <h1>404</h1>
      <p class="meta">That page doesn’t exist.</p>
      <p><a href="/" data-link>Go home</a></p>
    </section>
  `;
}

