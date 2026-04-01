import { $ } from './dom.js';

export function setBreadcrumb(text) {
  const el = $('#breadcrumbText');
  if (el) el.textContent = text || '';
}

export function setPageActionsEnabled({ canEdit = false, canDelete = false, canDuplicate = false, canOpenBeside = false } = {}) {
  const btnEdit = $('#btnEditPage');
  const btnDelete = $('#btnDeletePage');
  const btnDuplicate = $('#btnDuplicatePage');
  const btnOpenBeside = $('#btnOpenBesidePage');
  if (btnEdit) btnEdit.disabled = !canEdit;
  if (btnDelete) btnDelete.hidden = !canDelete;
  if (btnDuplicate) btnDuplicate.hidden = !canDuplicate;
  if (btnOpenBeside) btnOpenBeside.hidden = !canOpenBeside;
}
