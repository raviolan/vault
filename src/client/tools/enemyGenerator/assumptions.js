// Deterministic equipment assumptions for Actions generation.
// Kept small and readable; only used for text output in combat details.

export function chosenWeaponsForClass(clsId) {
  const id = String(clsId || '').toLowerCase();
  // Each weapon: { name, die, damageType, mode: 'melee'|'ranged', finesse?: true, range?: '80/320' }
  switch (id) {
    case 'fighter':
    case 'paladin':
    case 'cleric':
      return [
        { name: 'Longsword', die: 8, damageType: 'slashing', mode: 'melee', finesse: false },
      ];
    case 'barbarian':
      return [
        { name: 'Greataxe', die: 12, damageType: 'slashing', mode: 'melee', finesse: false },
      ];
    case 'rogue':
      return [
        { name: 'Rapier', die: 8, damageType: 'piercing', mode: 'melee', finesse: true },
        { name: 'Shortbow', die: 6, damageType: 'piercing', mode: 'ranged', finesse: false, range: '80/320' },
      ];
    case 'ranger':
      return [
        { name: 'Longbow', die: 8, damageType: 'piercing', mode: 'ranged', finesse: false, range: '150/600' },
        { name: 'Shortsword', die: 6, damageType: 'piercing', mode: 'melee', finesse: true },
      ];
    case 'monk':
      return [
        { name: 'Quarterstaff', die: 8, damageType: 'bludgeoning', mode: 'melee', finesse: true },
      ];
    case 'wizard':
    case 'sorcerer':
    case 'warlock':
      return [
        { name: 'Dagger', die: 4, damageType: 'piercing', mode: 'melee', finesse: true, range: '20/60' },
      ];
    case 'bard':
      return [
        { name: 'Rapier', die: 8, damageType: 'piercing', mode: 'melee', finesse: true },
      ];
    case 'druid':
      return [
        { name: 'Quarterstaff', die: 8, damageType: 'bludgeoning', mode: 'melee', finesse: true },
      ];
    default:
      return [
        { name: 'Dagger', die: 4, damageType: 'piercing', mode: 'melee', finesse: true },
      ];
  }
}

