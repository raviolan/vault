import { getAppState, setAppState } from '../../miniapps/state.js';
import { handleFormatShortcutKeydown } from '../../lib/formatShortcuts.js';

const APP_ID = 'notepad';

export const NotepadApp = {
  id: APP_ID,
  title: 'Notepad',
  surfaces: ['rightPanel'],
  mount(rootEl, ctx) {
    const textarea = (rootEl || document).querySelector('#notepad');
    if (!textarea) return () => {};

    // Initialize value from user state (legacy-compatible)
    textarea.value = getAppState(APP_ID, '') || '';

    let timer = null;
    const onInput = () => {
      clearTimeout(timer);
      const val = textarea.value;
      timer = setTimeout(() => setAppState(APP_ID, val), 300);
    };
    textarea.addEventListener('input', onInput);
    const onKeydown = (e) => { if (handleFormatShortcutKeydown(e, textarea)) return; };
    textarea.addEventListener('keydown', onKeydown);

    return () => {
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onKeydown);
      clearTimeout(timer);
    };
  },
  unmount() {},
};
