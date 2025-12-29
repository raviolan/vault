// UI preferences application helpers

export function applyUiPrefsToBody(state) {
  try {
    const on = state?.uiPrefsV1?.sectionHeaderHighlight !== false;
    document.body.dataset.sectionHl = on ? '1' : '0';
  } catch {}
}

export function getSectionHighlightEnabled(state) {
  return state?.uiPrefsV1?.sectionHeaderHighlight !== false;
}

