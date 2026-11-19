// Lecture des ratings de référence collés depuis une page de match (FACEIT, HLTV...).
// Tolérant : on cherche chaque joueur par son nom, puis le rating (nombre à 2 décimales,
// entre 0 et 3, hors pourcentages) sur sa ligne ou dans les quelques lignes suivantes.

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/** Nombres du type 1.23 (ou 1,23), en excluant les pourcentages et les signes +/−. */
function ratingsIn(line: string): number[] {
  const out: number[] = [];
  const re = /(^|[^\d+\-−.,])(\d)[.,](\d{2})(?![\d%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const v = Number(`${m[2]}.${m[3]}`);
    if (v >= 0 && v <= 3.5) out.push(v);
  }
  return out;
}

export interface PasteResult {
  steamid: string;
  name: string;
  value: number | null;
  /** Ligne où le joueur a été trouvé (pour vérification). */
  line: string | null;
}

export function parseReferencePaste(text: string, players: { steamid: string; name: string }[]): PasteResult[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const normLines = lines.map(norm);
  return players.map((p) => {
    const n = norm(p.name);
    if (!n) return { steamid: p.steamid, name: p.name, value: null, line: null };
    // Ligne contenant le nom (ou dont le nom est contenu dans le pseudo du jeu, ex. tag d'équipe)
    let idx = normLines.findIndex((l) => l.length > 0 && (l.includes(n) || (l.length >= 3 && n.includes(l.split(/\d/)[0] || '\u0000'))));
    if (idx < 0) {
      // Dernier recours : le premier « mot » de la ligne correspond au nom
      idx = lines.findIndex((l) => { const w = norm(l.split(/\s|\t/)[0] ?? ''); return w.length >= 3 && (n.includes(w) || w.includes(n)); });
    }
    if (idx < 0) return { steamid: p.steamid, name: p.name, value: null, line: null };
    // Rating : dernier nombre à 2 décimales sur la ligne, sinon dans les lignes suivantes (tableaux copiés cellule par cellule)
    for (let k = idx; k < Math.min(lines.length, idx + 14); k++) {
      if (k > idx && players.some((o) => o.steamid !== p.steamid && norm(o.name) && normLines[k].includes(norm(o.name)))) break;
      const vals = ratingsIn(lines[k]);
      if (vals.length) return { steamid: p.steamid, name: p.name, value: vals[vals.length - 1], line: lines[idx] };
    }
    return { steamid: p.steamid, name: p.name, value: null, line: lines[idx] };
  });
}
