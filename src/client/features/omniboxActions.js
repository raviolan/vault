import { navigate } from '../lib/router.js';
import { openCreateModal } from './modals.js';

function normalizeQuery(raw) {
  return String(raw || '').trim().toLowerCase();
}

function scoreAction(query, action) {
  if (!query) return action.alwaysVisible ? 1 : 0;
  const haystacks = [action.title, action.snippet, ...(action.keywords || [])]
    .map((part) => String(part || '').toLowerCase());
  let score = 0;
  for (const text of haystacks) {
    if (!text) continue;
    if (text === query) score = Math.max(score, 100);
    else if (text.startsWith(query)) score = Math.max(score, 75);
    else if (text.includes(query)) score = Math.max(score, 50);
  }
  return score;
}

function openPrefilledCreateModal(title) {
  openCreateModal();
  const input = document.querySelector('#createPageModal input[name="pageTitle"]');
  if (!input) return;
  input.value = title;
  input.focus();
  input.select?.();
}

export function getOmniboxActions(query) {
  const q = String(query || '').trim();
  const qLower = normalizeQuery(query);
  if (!qLower) return [];

  const actions = [
    {
      id: `search:${q}`,
      title: `Search all results for "${q}"`,
      type: 'action',
      snippet: 'Open the full search results page.',
      keywords: ['search', 'results', 'find'],
      run: () => navigate(`/search?q=${encodeURIComponent(q)}`),
      alwaysVisible: true,
    },
    {
      id: `create:${q}`,
      title: `Create page "${q}"`,
      type: 'action',
      snippet: 'Open the create page dialog with the title prefilled.',
      keywords: ['create', 'new page', 'add page'],
      run: () => openPrefilledCreateModal(q),
    },
    {
      id: 'route:dashboard',
      title: 'Go to Dashboard',
      type: 'action',
      snippet: 'Open the home dashboard.',
      keywords: ['home', 'dashboard', 'start'],
      run: () => navigate('/'),
    },
    {
      id: 'route:session',
      title: 'Go to Session',
      type: 'action',
      snippet: 'Open the session workspace.',
      keywords: ['session', 'prep', 'notes'],
      run: () => navigate('/session'),
    },
    {
      id: 'route:tags',
      title: 'Open Tag Inspector',
      type: 'action',
      snippet: 'Review tags and taxonomy.',
      keywords: ['tags', 'tag inspector', 'taxonomy'],
      run: () => navigate('/tags'),
    },
    {
      id: 'route:cleanup',
      title: 'Open Cleanup',
      type: 'action',
      snippet: 'Review cleanup suggestions and bulk maintenance tools.',
      keywords: ['cleanup', 'clean up', 'maintenance'],
      run: () => navigate('/cleanup'),
    },
    {
      id: 'route:health',
      title: 'Open Health Dashboard',
      type: 'action',
      snippet: 'Review vault health and content quality.',
      keywords: ['health', 'quality', 'dashboard'],
      run: () => navigate('/health'),
    },
    {
      id: 'route:archive',
      title: 'Browse Archive',
      type: 'action',
      snippet: 'Open the archive section.',
      keywords: ['archive', 'archived'],
      run: () => navigate('/archive'),
    },
    {
      id: 'route:settings',
      title: 'Open Settings',
      type: 'action',
      snippet: 'Open application settings.',
      keywords: ['settings', 'preferences', 'config'],
      run: () => navigate('/settings'),
    },
  ];

  return actions
    .map((action) => ({ action, score: scoreAction(qLower, action) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.action.title.localeCompare(b.action.title))
    .slice(0, 4)
    .map(({ action }) => action);
}
