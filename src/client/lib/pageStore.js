// Shared client-side page state to avoid scattered globals
let editModePageId = null;
let currentPageBlocks = [];

export function setEditModeForPage(pageId, on) {
  editModePageId = on ? pageId : null;
}

export function isEditingPage(pageId) {
  return editModePageId === pageId;
}

export function getCurrentPageBlocks() {
  return currentPageBlocks;
}

export function setCurrentPageBlocks(arr) {
  currentPageBlocks = Array.isArray(arr) ? arr.slice() : [];
}

export function updateCurrentBlocks(mapper) {
  currentPageBlocks = currentPageBlocks.map(mapper);
}

