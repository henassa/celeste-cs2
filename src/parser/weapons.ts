// Classification des armes / objets à partir des noms renvoyés par demoparser2.

const PISTOLS = new Set([
  'Glock-18', 'USP-S', 'P2000', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-Auto',
  'Desert Eagle', 'R8 Revolver', 'Dual Berettas',
]);

export const NADE_BY_ITEM: Record<string, 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy'> = {
  'Smoke Grenade': 'smoke',
  'Flashbang': 'flash',
  'High Explosive Grenade': 'he',
  'Molotov': 'molotov',
  'Incendiary Grenade': 'molotov',
  'Decoy Grenade': 'decoy',
};

export const BOMB_ITEM = 'C4 Explosive';

export function isKnife(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('knife') || n.includes('bayonet') || n.includes('karambit') || n.includes('dagger');
}

export function isPistol(name: string): boolean {
  return PISTOLS.has(name);
}

export function isUtilityOrGear(name: string): boolean {
  return name in NADE_BY_ITEM || name === BOMB_ITEM || name === 'Zeus x27' || isKnife(name);
}

/** Arme principale d'un inventaire : primaire si présente, sinon pistolet. */
export function mainWeaponOf(items: readonly string[]): string | null {
  let pistol: string | null = null;
  for (const it of items) {
    if (isUtilityOrGear(it)) continue;
    if (isPistol(it)) { pistol ??= it; continue; }
    return it;
  }
  return pistol;
}

/** Nom court et lisible pour le kill feed (les events donnent des noms internes). */
const KILLFEED_NAMES: Record<string, string> = {
  ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', m4a1_silencer_off: 'M4A1-S', awp: 'AWP',
  deagle: 'Deagle', glock: 'Glock', usp_silencer: 'USP-S', usp_silencer_off: 'USP-S', hkp2000: 'P2000',
  p250: 'P250', fiveseven: 'Five-SeveN', tec9: 'Tec-9', cz75a: 'CZ75', revolver: 'R8', elite: 'Berettas',
  galilar: 'Galil', famas: 'FAMAS', sg556: 'SG 553', aug: 'AUG', ssg08: 'Scout', g3sg1: 'G3SG1',
  scar20: 'SCAR-20', mac10: 'MAC-10', mp9: 'MP9', mp7: 'MP7', mp5sd: 'MP5-SD', ump45: 'UMP-45',
  p90: 'P90', bizon: 'PP-Bizon', nova: 'Nova', xm1014: 'XM1014', sawedoff: 'Sawed-Off', mag7: 'MAG-7',
  m249: 'M249', negev: 'Negev', taser: 'Zeus', hegrenade: 'HE', inferno: 'Fire', molotov: 'Molotov',
  incgrenade: 'Incendiary', flashbang: 'Flash', smokegrenade: 'Smoke', decoy: 'Decoy',
  planted_c4: 'Bomb', world: 'World', worldspawn: 'World',
};

export function killfeedWeapon(weapon: string): string {
  const w = weapon.replace(/^weapon_/, '');
  if (isKnife(w) || w.startsWith('knife') || w === 'bayonet') return 'Knife';
  return KILLFEED_NAMES[w] ?? w;
}
