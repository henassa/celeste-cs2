// Silhouettes d'armes et d'équipement (CS Demo Manager, licence MIT) : SVG bruts et correspondance des noms.

const raw = import.meta.glob('./icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const ICONS: Record<string, string> = {};
/** SVG d'origine (sans retouche), pour l'extrusion 3D. */
export const RAW_ICONS: Record<string, string> = {};
for (const [path, svg] of Object.entries(raw)) {
  const name = path.split('/').pop()!.replace('.svg', '');
  // Hauteur pilotée par la classe, largeur selon les proportions ; couleur = currentColor
  RAW_ICONS[name] = svg;
  ICONS[name] = svg.replace('<svg ', '<svg fill="currentColor" height="100%" preserveAspectRatio="xMidYMid meet" ');
}

/** Nom interne (ak47, weapon_m4a1_silencer) ou nom affiché (AK-47, Desert Eagle) -> icône. */
const ALIASES: Record<string, string> = {
  ak47: 'ak47', 'ak-47': 'ak47', aug: 'aug', awp: 'awp', bizon: 'bizon', 'pp-bizon': 'bizon', cz75a: 'cz75a', 'cz75-auto': 'cz75a',
  deagle: 'deagle', 'desert eagle': 'deagle', decoy: 'decoy', 'decoy grenade': 'decoy', defuser: 'defuser', kit: 'defuser',
  elite: 'dual-elite', 'dual berettas': 'dual-elite', famas: 'famas', fiveseven: 'five-seven', 'five-seven': 'five-seven',
  flashbang: 'flashbang', flash: 'flashbang', g3sg1: 'g3sg1', galilar: 'galilar', 'galil ar': 'galilar', glock: 'glock', 'glock-18': 'glock',
  hegrenade: 'he-grenade', he: 'he-grenade', 'high explosive grenade': 'he-grenade', incgrenade: 'incendiary-grenade', 'incendiary grenade': 'incendiary-grenade',
  inferno: 'molotov', molotov: 'molotov', m249: 'm249', m4a1: 'm4a4', m4a4: 'm4a4', m4a1_silencer: 'm4a1', 'm4a1-s': 'm4a1', m4a1_silencer_off: 'm4a1-silencer-off',
  mac10: 'mac10', 'mac-10': 'mac10', mag7: 'mag7', 'mag-7': 'mag7', mp5sd: 'mp5sd', 'mp5-sd': 'mp5sd', mp7: 'mp7', mp9: 'mp9', negev: 'negev', nova: 'nova',
  hkp2000: 'p2000', p2000: 'p2000', p250: 'p250', p90: 'p90', revolver: 'revolver', 'r8 revolver': 'revolver', sawedoff: 'sawed-off', 'sawed-off': 'sawed-off',
  scar20: 'scar20', 'scar-20': 'scar20', sg556: 'sg553', 'sg 553': 'sg553', smokegrenade: 'smoke-grenade', smoke: 'smoke-grenade', 'smoke grenade': 'smoke-grenade',
  ssg08: 'ssg08', 'ssg 08': 'ssg08', tec9: 'tec9', 'tec-9': 'tec9', ump45: 'ump45', 'ump-45': 'ump45', usp_silencer: 'usps', 'usp-s': 'usps', usp_silencer_off: 'usps-silencer-off',
  xm1014: 'xm1014', taser: 'zeus', 'zeus x27': 'zeus', zeus: 'zeus', c4: 'bomb', planted_c4: 'bomb', 'c4 explosive': 'bomb', bomb: 'bomb',
  world: 'world', worldspawn: 'world', kevlar: 'kevlar', helmet: 'armor-with-helmet', 'kevlar+h': 'armor-with-helmet', headshot: 'elimination-headshot',
  blind: 'blind', airborne: 'airborne-kill', 'flash assist': 'flashbang-assist',
};

export function iconFor(weapon: string): string | null {
  const w = weapon.toLowerCase().replace(/^weapon_/, '').trim();
  if (w.includes('knife') || w === 'bayonet' || w.includes('karambit') || w.includes('dagger')) return 'knife';
  return ALIASES[w] ?? (ICONS[w] ? w : null);
}

