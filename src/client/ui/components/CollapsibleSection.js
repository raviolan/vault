import { el } from '../els.js';

export function CollapsibleSection({ title = '', open = false } = {}, content) {
  const details = el('details', open ? { open: '' } : {});
  const summary = el('summary', { class: 'meta' }, title || '');
  details.appendChild(summary);
  if (content) details.appendChild(content);
  return details;
}

