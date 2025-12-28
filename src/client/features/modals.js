import { $, $$, escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { refreshNav } from './nav.js';
import { navigate } from '../lib/router.js';
import { getState, updateState, saveStateNow } from '../lib/state.js';
import { ensureSection } from '../lib/sections.js';

export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = '';
  m.focus?.();
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.style.display = 'none';
}

export function bindModalBasics(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal(modalId);
  });
  $$('.modal-cancel', m).forEach(btn => btn.addEventListener('click', () => closeModal(modalId)));
}

export function openCreateModal() {
  const modal = document.getElementById('createPageModal');
  if (!modal) return;
  const titleInput = modal.querySelector('input[name="pageTitle"]');
  titleInput.value = '';
  // Reset kind to page and UI defaults
  const kindSel = modal.querySelector('select[name="createKind"]');
  const pageTypeRow = modal.querySelector('[data-create-row="pageType"]');
  const titleLabel = modal.querySelector('[data-title-label]');
  const confirmBtn = modal.querySelector('.modal-confirm');
  const h2 = modal.querySelector('h2');
  if (kindSel) kindSel.value = 'page';
  if (pageTypeRow) pageTypeRow.style.display = '';
  if (titleLabel) titleLabel.textContent = 'Title';
  if (confirmBtn) confirmBtn.textContent = 'Create';
  if (h2) h2.textContent = 'Create New Page';

  // Bind create kind change once
  if (!modal.__createKindBound) {
    const onKindChange = () => {
      const kind = kindSel?.value || 'page';
      if (kind === 'section') {
        if (pageTypeRow) pageTypeRow.style.display = 'none';
        if (titleLabel) titleLabel.textContent = 'Section title';
        if (h2) h2.textContent = 'Create New Section';
        if (confirmBtn) confirmBtn.textContent = 'Create';
      } else {
        if (pageTypeRow) pageTypeRow.style.display = '';
        if (titleLabel) titleLabel.textContent = 'Title';
        if (h2) h2.textContent = 'Create New Page';
        if (confirmBtn) confirmBtn.textContent = 'Create';
      }
    };
    kindSel?.addEventListener('change', onKindChange);
    modal.__createKindBound = true;
  }
  openModal('createPageModal');
  setTimeout(() => titleInput.focus(), 0);
}

export async function createPageFromModal() {
  const modal = document.getElementById('createPageModal');
  if (!modal) return;
  const kind = modal.querySelector('select[name="createKind"]')?.value || 'page';
  if (kind === 'section') {
    const title = modal.querySelector('input[name="pageTitle"]').value.trim();
    if (!title) return;
    const st = getState();
    const { nextUserState, sectionId } = ensureSection(st, title);
    updateState(nextUserState);
    await saveStateNow();
    closeModal('createPageModal');
    await refreshNav();
    // Scroll the newly created section into view (best-effort)
    const nav = document.getElementById('navSections');
    const summaries = nav ? Array.from(nav.querySelectorAll('summary')) : [];
    const t = title.toLowerCase();
    const match = summaries.find(s => (s.textContent || '').toLowerCase().includes(t));
    try { match?.scrollIntoView({ block: 'nearest' }); } catch {}
    return;
  }

  // Default: create a page via API
  const type = modal.querySelector('select[name="pageType"]').value;
  const title = modal.querySelector('input[name="pageTitle"]').value.trim();
  if (!title) return;
  const page = await fetchJson('/api/pages', {
    method: 'POST',
    body: JSON.stringify({ title, type }),
  });
  closeModal('createPageModal');
  await refreshNav();
  navigate(`/page/${encodeURIComponent(page.id)}`);
}

export async function openDeleteModal(page) {
  const modal = document.getElementById('deletePageModal');
  if (!modal) return;

  modal.querySelector('.delete-page-title-label').textContent = page.title;
  const input = modal.querySelector('input[name="deleteConfirmTitle"]');
  const confirmBtn = modal.querySelector('.modal-confirm');

  input.value = '';
  confirmBtn.disabled = true;

  const onInput = () => {
    confirmBtn.disabled = input.value.trim() !== page.title;
  };
  input.oninput = onInput;

  confirmBtn.onclick = async () => {
    await fetchJson(`/api/pages/${encodeURIComponent(page.id)}`, { method: 'DELETE' });
    closeModal('deletePageModal');
    await refreshNav();
    navigate('/');
  };

  openModal('deletePageModal');
  setTimeout(() => input.focus(), 0);
}
