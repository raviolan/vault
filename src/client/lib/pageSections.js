export function sectionForType(type) {
  switch (type) {
    case 'npc': return 'NPCs';
    case 'location': return 'World';
    case 'arc': return 'Arcs';
    case 'tool': return 'Tools';
    case 'pc':
    case 'character':
    default:
      return type === 'note' ? 'Campaign' : 'Characters';
  }
}

export function sectionKeyForType(type) {
  switch (type) {
    case 'npc': return 'npcs';
    case 'location': return 'world';
    case 'arc': return 'arcs';
    case 'tool': return 'tools';
    case 'note': return 'campaign';
    case 'pc':
    case 'character':
    default: return 'characters';
  }
}
