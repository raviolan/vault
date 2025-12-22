// Pure utilities to build a simple, consistent combat details block
// for a generated character. Inputs must be plain data.

function avgDie(d) { return Math.floor(d / 2) + 1; }
function fmtMod(n) { return (n >= 0 ? '+' : '') + String(n); }

function abilityKeyFromSpellcasting(ability) {
  const a = String(ability || '').trim().toLowerCase();
  if (/int/.test(a)) return 'int';
  if (/wis/.test(a)) return 'wis';
  if (/cha/.test(a)) return 'cha';
  if (/str/.test(a)) return 'str';
  if (/dex/.test(a)) return 'dex';
  if (/con/.test(a)) return 'con';
  return 'int';
}

function isMartialClass(clsId) {
  const id = String(clsId || '').toLowerCase();
  return ['fighter', 'paladin', 'ranger', 'barbarian', 'monk'].includes(id);
}

function attackAbilityForWeapon(weapon, stats) {
  if (weapon.mode === 'ranged') return 'dex';
  if (weapon.finesse) return (stats.dex >= stats.str ? 'dex' : 'str');
  return 'str';
}

function attackBonus(weapon, prof, stats) {
  const k = attackAbilityForWeapon(weapon, stats);
  return prof + (k && Number.isFinite(stats[k]) ? Math.floor((stats[k] - 10) / 2) : 0);
}

function meleeText(name, bonus, die, dmg, mod) {
  const avg = avgDie(die) + mod;
  const modText = (mod !== 0 ? ` ${fmtMod(mod)}` : '');
  return `${name}: Melee Weapon Attack: ${fmtMod(bonus)} to hit, reach 5 ft., one target. Hit: ${avg} (1d${die}${modText}) ${dmg} damage.`;
}

function rangedText(name, bonus, die, dmg, mod, range) {
  const avg = avgDie(die) + mod;
  const modText = (mod !== 0 ? ` ${fmtMod(mod)}` : '');
  const r = range || '80/320';
  return `${name}: Ranged Weapon Attack: ${fmtMod(bonus)} to hit, range ${r} ft., one target. Hit: ${avg} (1d${die}${modText}) ${dmg} damage.`;
}

function rogueSneakDice(level) {
  // Approximation of Sneak Attack dice progression (levels 1..20)
  const table = [0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10];
  return table[Math.max(0, Math.min(20, level))];
}

export function buildCombatDetails(character, assumptions) {
  const { level, stats, mod, prof, classId, className, raceName, cls, spellsPick } = character;
  const actions = [];
  const reactions = [];
  const traits = [];
  let spellcasting = null;

  // Multiattack (martial focus)
  if (isMartialClass(classId) && level >= 5) {
    let count = 2;
    const id = String(classId || '').toLowerCase();
    if (id === 'fighter') {
      if (level >= 20) count = 4; else if (level >= 11) count = 3; else count = 2;
    }
    actions.push({ name: 'Multiattack', text: `Multiattack: The enemy makes ${count} attacks: one with the primary weapon and additional attacks with the same weapon.` });
  }

  // Primary/secondary weapon attacks
  const weapons = (assumptions?.weapons || []).slice(0, 2);
  for (const w of weapons) {
    const abilityKey = attackAbilityForWeapon(w, stats);
    const abilityMod = mod[abilityKey] || 0;
    const toHit = attackBonus(w, prof, stats);
    const text = (w.mode === 'ranged')
      ? rangedText(w.name, toHit, w.die, w.damageType, abilityMod, w.range)
      : meleeText(w.name, toHit, w.die, w.damageType, abilityMod);
    actions.push({ name: w.name, text });
  }

  // Minimal generic reaction
  reactions.push({ name: 'Opportunity Attack', text: 'When a hostile creature the enemy can see moves out of their reach, the enemy makes one melee attack.' });

  // Traits — minimal and high-signal
  const id = String(classId || '').toLowerCase();
  if (id === 'rogue') {
    const dice = rogueSneakDice(level);
    if (dice > 0) traits.push({ name: 'Sneak Attack', text: `Once per turn, the enemy can deal an extra ${dice}d6 damage to one creature they hit with an attack if they have advantage on the attack roll or an ally is adjacent to the target.` });
  }
  if (id === 'barbarian') traits.push({ name: 'Rage', text: 'As a bonus action, the enemy can enter a rage, gaining damage bonuses and resistances. Rage lasts 1 minute and ends early if the enemy is unconscious.' });
  if (id === 'paladin') traits.push({ name: 'Divine Smite', text: 'When the enemy hits with a melee weapon attack, they can expend a spell slot to deal extra radiant damage to the target.' });
  if (id === 'monk') traits.push({ name: 'Martial Arts', text: 'When unarmed or wielding monk weapons, the enemy can use DEX for attacks and damage and make an unarmed strike as a bonus action.' });
  if (id === 'ranger') traits.push({ name: 'Hunter Instincts', text: 'The enemy excels at tracking and skirmishing; apply advantage or bonus damage when applicable (DM adjudication).'});
  if (id === 'cleric') traits.push({ name: 'Channel Divinity', text: 'The enemy can channel divine energy to fuel special effects; uses refresh on a short or long rest.' });

  // Race highlights (best-effort from race name)
  if (/dark/i.test(raceName || '')) traits.push({ name: 'Darkvision', text: 'The enemy can see in darkness out to a typical range (DM sets exact range).' });

  // Spellcasting block using existing pick
  if (cls?.spellcasting_ability) {
    const key = abilityKeyFromSpellcasting(cls.spellcasting_ability);
    const cMod = mod[key] || 0;
    const dc = 8 + prof + cMod;
    const toHit = prof + cMod;
    const header = `Spellcasting: The enemy is a level ${level} spellcaster. Spell save DC ${dc}, ${fmtMod(toHit)} to hit with spell attacks.`;
    const byLevel = [];
    if (spellsPick) {
      const cans = (spellsPick.cantrips || []).map(s => s.name).slice(0, 6);
      if (cans.length) byLevel.push({ levelLabel: 'Cantrips (at will)', spells: cans });
      const levels = new Map();
      for (const s of (spellsPick.spells || [])) {
        const lvParsed = (s.level_int ?? parseInt(s.level, 10));
        const lv = Number.isFinite(lvParsed) ? Number(lvParsed) : 1;
        const label = `${lv}st level`;
        if (!levels.has(label)) levels.set(label, []);
        if (levels.get(label).length < 8) levels.get(label).push(s.name);
      }
      for (const [label, list] of levels) byLevel.push({ levelLabel: label, spells: list });
    }
    spellcasting = { header, spellsByLevel: byLevel };
  }

  return { actions, reactions, traits, spellcasting };
}
