import { $, $$, escapeHtml } from '../lib/dom.js';
import { fetchJson } from '../lib/http.js';
import { refreshNav } from './nav.js';
import { navigate } from '../lib/router.js';

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
  openModal('createPageModal');
  setTimeout(() => titleInput.focus(), 0);
}

export async function createPageFromModal() {
  const modal = document.getElementById('createPageModal');
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

