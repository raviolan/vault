// Tiny helper to set a consistent document title across routes
// Usage: setDocumentTitle('My Page') -> 'My Page — DM Vault'
//        setDocumentTitle('')        -> 'DM Vault'
export function setDocumentTitle(main) {
  try {
    const raw = (main == null) ? '' : String(main);
    const trimmed = raw.trim();
    if (!trimmed) {
      document.title = 'DM Vault';
      return;
    }
    document.title = `${trimmed} — DM Vault`;
  } catch {
    // No-op: avoid any side effects beyond title set attempts
  }
}

