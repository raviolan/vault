// Registry of core tools available in the app (non-page tools)
export const TOOLS = [
  {
    id: 'enemy-generator',
    name: 'Enemy Generator',
    path: '/tools/enemy-generator',
    icon: '⚔️',
  },
  {
    id: 'tags',
    name: 'Tags',
    path: '/tags',
    icon: '🏷️',
  },
  {
    id: 'hp-tracker',
    name: 'HP Tracker',
    path: '/apps/hp',
    icon: '❤️',
  },
  {
    id: 'cleanup',
    name: 'Cleanup',
    path: '/cleanup',
    icon: '🧹',
  },
  {
    id: 'health',
    name: 'Health',
    path: '/health',
    icon: '🩺',
  },
];

export function getToolById(id) {
  return TOOLS.find(t => t.id === id) || null;
}
