// Registry of core tools available in the app (non-page tools)
export const TOOLS = [
  {
    id: 'enemy-generator',
    name: 'Enemy Generator',
    path: '/tools/enemy-generator',
    icon: '⚔️',
  },
  {
    id: 'hp-tracker',
    name: 'HP Tracker',
    path: '/apps/hp',
    icon: '❤️',
  },
];

export function getToolById(id) {
  return TOOLS.find(t => t.id === id) || null;
}
