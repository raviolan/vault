import { apiPatchBlock } from './apiBridge.js';

const patchTimers = Object.create(null);

export function debouncePatch(blockId, patch, delay = 400) {
  clearTimeout(patchTimers[blockId]);
  patchTimers[blockId] = setTimeout(async () => {
    try {
      await apiPatchBlock(blockId, patch);
    } catch (e) {
      console.error('patch failed', e);
    }
  }, delay);
}

