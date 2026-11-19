// Modèle de probabilité de victoire d'un round (v0, heuristique et transparent).
// Base du « Round Swing » : chaque action vaut la variation de probabilité de victoire qu'elle provoque.
//
// HLTV (Rating 3.0) et FACEIT (FACEIT Rating) utilisent le même principe avec des modèles
// entraînés sur des millions de rounds, non publiés. Ce modèle-ci est volontairement simple
// et documenté ; il sera recalibré sur les démos accumulées localement (analyse multi-démos).

export interface RoundState {
  aliveT: number;
  aliveCT: number;
  /** Valeur d'équipement totale des vivants ($). */
  equipT: number;
  equipCT: number;
  bombPlanted: boolean;
  /** Secondes restantes avant la fin du temps (sans bombe posée). */
  timeLeft: number;
}

/** Force d'une équipe : un joueur full-buy vaut 1, un joueur au pistolet de départ environ 0,6. */
function strength(alive: number, equip: number): number {
  if (alive <= 0) return 0;
  const perPlayer = equip / alive;
  return alive * (0.6 + 0.4 * Math.min(1, perPlayer / 4500));
}

/** Probabilité que les T gagnent le round dans cet état. */
export function winProbabilityT(s: RoundState): number {
  if (s.aliveT <= 0 && !s.bombPlanted) return 0;
  if (s.aliveCT <= 0) return 1;
  if (s.aliveT <= 0) return 0.45; // bombe posée, T tous morts : dépend du défuse (approximation)
  const sT = strength(s.aliveT, s.equipT);
  const sCT = strength(s.aliveCT, s.equipCT);
  // Écart de joueurs + rapport de forces (calé pour : 5v4 ≈ 70 %, 3v2 ≈ 77 %, 2v1 ≈ 84 %)
  let z = 0.55 * (s.aliveT - s.aliveCT) + 1.6 * Math.log(sT / sCT);
  if (s.bombPlanted) z += 0.9;
  else if (s.timeLeft < 20) z -= ((20 - Math.max(0, s.timeLeft)) / 20) * 2; // le temps joue pour les CT
  return 1 / (1 + Math.exp(-z));
}
