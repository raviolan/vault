// Deterministic-ish generation helpers for an enemy NPC.

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

const CLASS_PRIORITIES = {
  barbarian: ['str', 'con', 'dex'],
  bard: ['cha', 'dex', 'con'],
  cleric: ['wis', 'con', 'str'],
  druid: ['wis', 'con', 'dex'],
  fighter: ['str', 'con', 'dex'],
  monk: ['dex', 'wis', 'con'],
  paladin: ['str', 'cha', 'con'],
  ranger: ['dex', 'wis', 'con'],
  rogue: ['dex', 'int', 'con'],
  sorcerer: ['cha', 'con', 'dex'],
  warlock: ['cha', 'con', 'dex'],
  wizard: ['int', 'con', 'dex'],
};

const FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard']);
const HALF_CASTERS = new Set(['paladin', 'ranger']);
const WARLOCK = 'warlock';

export function abilityMod(score) { return Math.floor((score - 10) / 2); }

export function assignStandardArray(clsId, race) {
  const pri = CLASS_PRIORITIES[clsId] || ['str', 'dex', 'con'];
  const stats = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  const order = [...pri, ...Object.keys(stats).filter(k => !pri.includes(k))];
  const arr = STANDARD_ARRAY.slice();
  order.forEach((k, idx) => { stats[k] = arr[idx]; });

  // Apply racial ASIs when present (simple parse for "+2 STR, +1 CON" or map)
  const asi = race?.asi || '';
  if (typeof asi === 'string') {
    const matches = asi.matchAll(/\+(\d)\s*(STR|DEX|CON|INT|WIS|CHA)/gi);
    for (const m of matches) {
      const val = Number(m[1] || 0);
      const key = String(m[2] || '').toLowerCase();
      if (stats[key] != null) stats[key] += val;
    }
  } else if (asi && typeof asi === 'object') {
    for (const k of Object.keys(stats)) {
      if (typeof asi[k] === 'number') stats[k] += asi[k];
    }
  }
  return stats;
}

export function proficiencyBonus(level) {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function computeHP(level, clsHitDie, conMod) {
  const die = Number(String(clsHitDie || 'd8').replace(/[^0-9]/g, '')) || 8;
  const avgDie = Math.floor(die / 2) + 1;
  let hp = Math.max(1, die + conMod);
  for (let i = 2; i <= level; i++) {
    const part = Math.max(1, avgDie + conMod);
    hp += part;
  }
  return hp;
}

export function computeAC(clsId, dexMod, classText = '') {
  // Default: 10 + DEX. If medium/heavy armor proficiency implied, assume baseline.
  const hasArmor = /medium armor|heavy armor/i.test(classText || '') || /fighter|paladin|cleric|ranger|barbarian/i.test(clsId);
  if (!hasArmor) return 10 + dexMod;
  // Assume chain shirt (base 13 + Dex up to 2) for medium; 16 for chain mail for heavy
  const heavy = /heavy armor/i.test(classText || '') || /paladin|fighter/i.test(clsId);
  if (heavy) return 16; // assuming chain mail
  return 13 + Math.min(2, Math.max(0, dexMod)); // chain shirt baseline
}

export function maxSpellLevel(clsId, level) {
  const id = String(clsId || '').toLowerCase();
  if (id === WARLOCK) return Math.min(5, Math.floor((Math.max(level, 1) + 1) / 4));
  if (FULL_CASTERS.has(id)) {
    // approx progression
    const table = [0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,9,9];
    return table[Math.max(0, Math.min(20, level))];
  }
  if (HALF_CASTERS.has(id)) {
    if (level < 2) return 0;
    if (level < 5) return 1;
    if (level < 9) return 2;
    if (level < 13) return 3;
    if (level < 17) return 4;
    return 5;
  }
  return 0;
}

export function pickSpells(spellList, maxLevel, level) {
  // Simple selection: 2-4 cantrips, and a handful of leveled spells up to maxLevel
  const levelOf = (s) => {
    const a = (s.level_int ?? parseInt(s.level, 10));
    return Number.isFinite(a) ? Number(a) : 0;
  };
  const cantrips = spellList.filter(s => levelOf(s) === 0);
  const leveled = spellList.filter(s => levelOf(s) > 0 && levelOf(s) <= maxLevel);
  const nCan = Math.min(4, Math.max(2, Math.floor(level / 6) + 2));
  const nSpells = Math.min(8, Math.max(3, maxLevel * 2));
  const take = (arr, n) => arr.slice(0, n);
  return { cantrips: take(cantrips, nCan), spells: take(leveled, nSpells) };
}

export function buildPreview({ name, race, cls, level, stats }) {
  const mod = Object.fromEntries(Object.entries(stats).map(([k,v]) => [k, abilityMod(v)]));
  const prof = proficiencyBonus(level);
  const hp = computeHP(level, cls?.hit_dice || '1d8', mod.con);
  const ac = computeAC(String(cls?.slug || cls?.name || '').toLowerCase(), mod.dex, cls?.prof_armor || cls?.desc || '');
  const speed = (race?.speed?.walk ? Number(race.speed.walk) : Number(race?.speed) || 30) || 30;
  return { name, raceName: race?.name || '', className: cls?.name || '', level, stats, mod, hp, ac, speed, prof };
}
