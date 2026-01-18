// Plain-language mapping and dialog for image upload failures
import { openModal, closeModal } from '../features/modals.js';

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
]);

export function explainUploadError(err, { file = null, status = null, serverMessage = '' } = {}) {
  try {
    // Prefer explicit status if provided; otherwise parse from Error message like "404 Not Found — body"
    let s = Number.isFinite(status) ? Number(status) : null;
    if (!s && err && typeof err.message === 'string') {
      const m = err.message.match(/^(\d{3})\b/);
      if (m) s = Number(m[1]);
    }

    // Client-side hints
    if (file && file.type && !Array.from(ALLOWED_MIME).some(t => (file.type || '').includes(t))) {
      return "That file type isn’t supported. Try PNG or JPG.";
    }
    if (file && Number.isFinite(file.size) && file.size > 10 * 1024 * 1024) {
      return "That image is too large to upload. Try a smaller file.";
    }

    // Network/browser errors (fetch failures often have TypeError or no status)
    if (!s) {
      return "Couldn’t reach the server. Check your connection and try again.";
    }

    // Prefer safe, plain server message if present, but strip code-like fragments
    const safeMsg = sanitizeServerMessage(serverMessage || extractServerTail(err?.message || ''));
    if (safeMsg) {
      // Only trust clearly plain phrases; otherwise fall back to mapping below
      if (!looksLikeCodey(safeMsg)) return safeMsg;
    }

    // Status-class mapping without showing codes to the user
    if (s === 413) return "That image is too large for the server. Try a smaller file.";
    if (s === 415) return "That file type isn’t supported. Try PNG or JPG.";
    if (s === 401 || s === 403) return "You don’t have permission to upload images here.";
    if (s === 507) return "The server is out of storage. Try again later.";
    if (s >= 500) return "The server had a problem uploading the image. Try again in a moment.";

    // Generic fallback
    return "Image upload failed. Please try again.";
  } catch {
    return "Image upload failed. Please try again.";
  }
}

function extractServerTail(msg) {
  // Given "404 Not Found — {\"error\":...}" or text, try to take part after dash
  if (!msg) return '';
  const idx = msg.indexOf('—');
  if (idx >= 0) return msg.slice(idx + 1).trim();
  return '';
}

function looksLikeCodey(s) {
  if (!s) return false;
  const t = s.toLowerCase();
  // crude filters: stack traces, JSON blobs, http codes, file paths
  return /exception|stack|\bhttp\b|\bjson\b|error\s*:\s*|\{.*\}|\/|\\/.test(t);
}

function sanitizeServerMessage(s) {
  if (!s) return '';
  let t = String(s);
  // remove obvious braces, quotes
  try { t = t.replace(/[{}\[\]"]/g, ' ').trim(); } catch {}
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  // limit length for safety
  if (t.length > 240) t = t.slice(0, 240).trim();
  return t;
}

export function showUploadErrorDialog(message) {
  const modal = document.getElementById('uploadErrorModal');
  if (!modal) { alert(message); return; }
  const body = modal.querySelector('.upload-error-message');
  if (body) body.textContent = String(message || 'Image upload failed.');
  const ok = modal.querySelector('.modal-confirm');
  if (ok && !ok.__dmv_bound) {
    ok.addEventListener('click', () => closeModal('uploadErrorModal'));
    ok.__dmv_bound = true;
  }
  openModal('uploadErrorModal');
}

export const UploadUserError = {
  explainUploadError,
  showUploadErrorDialog,
};
