import { $ } from './dom.js';

export function setBreadcrumb(text) {
  const el = $('#breadcrumbText');
  if (el) el.textContent = text || '';
}

export function setPageActionsEnabled({ canEdit = false, canDelete = false } = {}) {
  const btnEdit = $('#btnEditPage');
  const btnDelete = $('#btnDeletePage');
  if (btnEdit) btnEdit.disabled = !canEdit;
  if (btnDelete) btnDelete.hidden = !canDelete;
}
