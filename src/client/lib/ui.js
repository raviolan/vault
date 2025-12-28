import { $ } from './dom.js';

export function setBreadcrumb(text) {
  const el = $('#breadcrumbText');
  if (el) el.textContent = text || '';
}

export function setPageActionsEnabled({ canEdit = false, canDelete = false } = {}) {
  const btnEdit = $('#btnEditPage');
  const btnEditLocal = $('#btnEditPageLocal');
  const btnDelete = $('#btnDeletePage');
  const btnDeleteLocal = $('#btnDeletePageLocal');
  if (btnEdit) btnEdit.disabled = !canEdit;
  if (btnEditLocal) btnEditLocal.disabled = !canEdit;
  if (btnDelete) btnDelete.hidden = !canDelete;
  if (btnDeleteLocal) btnDeleteLocal.hidden = !canDelete;
}
