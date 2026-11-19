// Acteurs de la vue 3D : silhouettes de joueurs avec l'arme en main (extrudée depuis l'icône),
// grenades (trajectoires, fumées, feux, éclats). Monochrome, comme le reste de l'interface.

import * as THREE from 'three';
import { readRenderTheme } from '@/viewer/theme';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { RAW_ICONS, iconFor } from '@/assets/icons';

/** Échelle monde -> scène (doit rester égale à celle de map-scene). */
export const S = 1 / 32;

// --- Armes ---

const weaponCache = new Map<string, THREE.BufferGeometry | null>();

/** Géométrie 3D d'une arme : silhouette de l'icône extrudée, longueur réelle approximative. */
export function weaponGeometry(weapon: string): THREE.BufferGeometry | null {
  const name = iconFor(weapon);
  if (!name) return null;
  if (weaponCache.has(name)) return weaponCache.get(name)!;
  const svg = RAW_ICONS[name];
  let geo: THREE.BufferGeometry | null = null;
  if (svg) {
    try {
      const data = new SVGLoader().parse(svg);
      const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
      const g = new THREE.ExtrudeGeometry(shapes, { depth: 3, bevelEnabled: false, curveSegments: 3 });
      g.computeBoundingBox();
      const b = g.boundingBox!;
      const len = b.max.x - b.min.x || 1;
      // Longueurs en unités du jeu : fusils ~ 34, pistolets ~ 12, grenades ~ 6
      const isRifle = len / Math.max(1e-3, b.max.y - b.min.y) > 2.2;
      const target = name.includes('grenade') || ['flashbang', 'molotov', 'decoy', 'he-grenade'].includes(name) ? 9 : isRifle ? 34 : 12;
      const k = (target / len) * S;
      // Icône : x vers la droite, y vers le bas ; arme : canon vers +X, dessus vers +Y
      g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -1.5);
      g.scale(k, -k, k);
      // Les icônes ont le canon à droite : il pointe déjà vers l'avant (+X)
      g.computeVertexNormals();
      geo = g;
    } catch { geo = null; }
  }
  weaponCache.set(name, geo);
  return geo;
}

// --- Joueurs ---

export interface Figure {
  group: THREE.Group; body: THREE.Group; weapon: THREE.Mesh; weaponName: string; ring: THREE.Mesh; label: THREE.Sprite; mat: THREE.MeshLambertMaterial;
  legL: THREE.Group; legR: THREE.Group; upper: THREE.Group; aim: THREE.Group;
}

export interface Pose {
  /** Vitesse horizontale (unités du jeu / s). */
  speed: number;
  /** Angle vertical de la vue (degrés, négatif = vers le haut). */
  pitch: number;
  duck: boolean;
  /** Pose, défuse : accroupi, bras baissés. */
  busy: boolean;
  /** Temps de lecture (s) : cadence de la marche. */
  time: number;
  /** Direction du déplacement (degrés, comme yaw) : pour choisir le clip avant / arrière / côté. */
  moveYaw?: number;
  planting?: boolean;
  defusing?: boolean;
  /** Lance une grenade en ce moment (± quelques dixièmes de seconde). */
  throwing?: boolean;
  /** En l'air : impulsion du saut ou chute. */
  air?: 'rise' | 'fall';
  /** Action du haut du corps en cours (sortie d'arme, rechargement, tir) et son âge (s). */
  overlay?: { kind: 'draw' | 'reload' | 'shoot'; age: number } | null;
}

const CT_COLOR = 0xe9e9e9, T_COLOR = 0x5a5a5a;

/**
 * Silhouette articulée (hanches, jambes, buste, bras qui visent) : animée d'après la démo
 * (vitesse -> foulée, angle de vue -> visée, accroupi, pose / défuse).
 */
export function makeFigure(ct: boolean, label: THREE.Sprite): Figure {
  const mat = new THREE.MeshLambertMaterial({ color: ct ? CT_COLOR : T_COLOR });
  const mesh = (geo: THREE.BufferGeometry, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x * S, y * S, z * S);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w * S, h * S, d * S);
  const body = new THREE.Group();
  // Jambes : pivot à la hanche (y = 32), la jambe pend en dessous
  const leg = (z: number) => {
    const g = new THREE.Group();
    g.position.set(0, 32 * S, z * S);
    mesh(box(7, 32, 6), 0, -16, 0, g);
    body.add(g);
    return g;
  };
  const legL = leg(-4.5), legR = leg(4.5);
  // Buste : pivot à la hanche, porte la tête et les bras
  const upper = new THREE.Group();
  upper.position.set(0, 32 * S, 0);
  body.add(upper);
  mesh(box(10, 26, 18), 0, 13, 0, upper);
  const head = new THREE.Mesh(new THREE.SphereGeometry(5.5 * S, 12, 10), mat);
  head.position.set(0, 32 * S, 0);
  upper.add(head);
  // Bras + arme : pivot à l'épaule, tournent avec l'angle de vue
  const aim = new THREE.Group();
  aim.position.set(0, 21 * S, 0);
  upper.add(aim);
  mesh(box(16, 5, 5), 8, -1, 6, aim);
  mesh(box(16, 5, 5), 8, -1, -4, aim);
  const weapon = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide }));
  weapon.position.set(17 * S, 0, 1 * S);
  aim.add(weapon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  label.position.y = 78 * S;
  const group = new THREE.Group();
  group.add(body, ring, label);
  return { group, body, weapon, weaponName: '', ring, label, mat, legL, legR, upper, aim };
}

/** Applique la pose : foulée selon la vitesse, accroupi, visée selon l'angle de vue. */
export function poseFigure(f: Figure, p: Pose): void {
  const run = Math.min(1, p.speed / 250);             // 250 u/s : course au couteau ~ 250, au fusil ~ 215
  const cadence = 1.2 + 1.0 * run;                     // pas par seconde
  const phase = p.time * cadence * Math.PI * 2;
  const crouch = p.duck || p.busy;
  const swing = (crouch ? 0.25 : 0.6) * run * Math.sin(phase);
  // Hanches plus basses accroupi ; jambes fléchies vers l'avant
  const hip = crouch ? 20 : 32 + Math.abs(Math.sin(phase)) * 1.5 * run;
  f.legL.position.y = f.legR.position.y = f.upper.position.y = hip * S;
  f.legL.rotation.z = (crouch ? 0.9 : 0) + swing;
  f.legR.rotation.z = (crouch ? 0.9 : 0) - swing;
  f.legL.scale.y = f.legR.scale.y = crouch ? 0.75 : 1;
  // Buste un peu penché en courant ; visée : pitch négatif = vers le haut
  f.upper.rotation.z = -0.12 * run - (p.busy ? 0.5 : 0);
  f.aim.rotation.z = p.busy ? -0.9 : THREE.MathUtils.degToRad(-p.pitch) * 0.9;
}

export function setFigureWeapon(f: Figure, weapon: string): void {
  if (f.weaponName === weapon) return;
  f.weaponName = weapon;
  const g = weaponGeometry(weapon);
  f.weapon.visible = !!g;
  if (g) f.weapon.geometry = g;
}

/** Couleur du camp (réglage des couleurs d'équipes, sinon le monochrome par défaut). */
const colorCache = new Map<string, number>();
export function figureColor(ct: boolean): number {
  if (typeof document === 'undefined') return ct ? CT_COLOR : T_COLOR;
  const css = ct ? readRenderTheme().ct.fill : readRenderTheme().t.fill;
  let hex = colorCache.get(css);
  if (hex === undefined) {
    hex = new THREE.Color().setStyle(css).getHex();
    // Le monochrome d'origine reste identique (les teintes par défaut du thème donnent les gris de la 3D)
    if (css === 'rgb(250, 250, 250)' || css === '#fafafa') hex = CT_COLOR;
    if (css === 'rgb(64, 64, 64)' || css === '#404040') hex = T_COLOR;
    colorCache.set(css, hex);
  }
  return hex;
}

// --- Grenades ---

export interface NadeVisual {
  id: number;
  kind: 'smoke' | 'molotov' | 'flash' | 'he' | 'decoy';
  /** Trajectoire jusqu'à l'instant présent (monde), vide quand elle a disparu. */
  path: number[];
  /** Position de l'effet (monde) et avancement 0..1, ou null avant l'éclatement. */
  effect: { x: number; y: number; z: number; t: number; elapsed: number; remaining: number } | null;
}

const RADIUS = { smoke: 144, molotov: 125, he: 220, flash: 110, decoy: 40 };

export class NadeLayer {
  readonly group = new THREE.Group();
  private items = new Map<number, { line: THREE.Line; fx: THREE.Object3D | null; head: THREE.Mesh | null; kind: NadeVisual['kind']; cells?: { d: number }[]; maxD?: number; mat?: THREE.Material }>();
  private burstMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, wireframe: true });
  private headGeo = new THREE.IcosahedronGeometry(3 * S, 1);
  private headMat = new THREE.MeshLambertMaterial({ color: 0x1f1f1f });
  private lineMat = { light: new THREE.LineDashedMaterial({ color: 0xe5e5e5, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.9 }), fire: new THREE.LineDashedMaterial({ color: 0xef4444, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.9 }) };
  private puff = new THREE.IcosahedronGeometry(10 * S, 1);
  private flame = new THREE.ConeGeometry(6 * S, 20 * S, 5).translate(0, 10 * S, 0);
  /** Propagation dans la carte (fournie par la scène : null tant qu'elle n'est pas chargée). */
  volumes: { smoke: (x: number, y: number, z: number) => { x: number; y: number; z: number; d: number }[]; fire: (x: number, y: number, z: number) => { x: number; y: number; z: number; d: number }[] } | null = null;
  private clock = 0;

  update(list: NadeVisual[]): void {
    this.clock = performance.now() / 1000;
    const seen = new Set<number>();
    for (const n of list) {
      seen.add(n.id);
      let it = this.items.get(n.id);
      if (!it) {
        const line = new THREE.Line(new THREE.BufferGeometry(), n.kind === 'molotov' || n.kind === 'he' ? this.lineMat.fire : this.lineMat.light);
        this.group.add(line);
        it = { line, fx: null, head: null, kind: n.kind };
        this.items.set(n.id, it);
      }
      // Trajectoire et grenade en vol
      if (n.path.length >= 6) {
        const pts = new Float32Array(n.path.length);
        for (let i = 0; i < n.path.length; i += 3) { pts[i] = n.path[i] * S; pts[i + 1] = n.path[i + 2] * S; pts[i + 2] = -n.path[i + 1] * S; }
        it.line.geometry.dispose();
        it.line.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3));
        it.line.computeLineDistances();
        it.line.visible = true;
      } else it.line.visible = false;
      const flying = !n.effect && n.path.length >= 3;
      if (flying) {
        if (!it.head) { it.head = new THREE.Mesh(this.headGeo, this.headMat); this.group.add(it.head); }
        const k = n.path.length - 3;
        it.head.position.set(n.path[k] * S, n.path[k + 2] * S, -n.path[k + 1] * S);
        it.head.rotation.set(this.clock * 9, this.clock * 7, 0);
        it.head.visible = true;
      } else if (it.head) it.head.visible = false;
      // Effet
      if (n.effect) this.effect(it, n);
      else if (it.fx) it.fx.visible = false;
    }
    for (const [id, it] of this.items) if (!seen.has(id)) {
      this.group.remove(it.line); it.line.geometry.dispose();
      if (it.fx) { this.group.remove(it.fx); if (it.fx instanceof THREE.InstancedMesh) it.fx.dispose(); }
      if (it.head) this.group.remove(it.head);
      it.mat?.dispose();
      this.items.delete(id);
    }
  }

  private effect(it: NonNullable<ReturnType<NadeLayer['items']['get']>>, n: NadeVisual): void {
    const e = n.effect!;
    // Fumée et feu : propagation réelle dans la carte quand la géométrie est disponible
    if ((n.kind === 'smoke' || n.kind === 'molotov') && this.volumes) {
      if (!it.fx) {
        const cells = n.kind === 'smoke' ? this.volumes.smoke(e.x, e.y, e.z) : this.volumes.fire(e.x, e.y, e.z);
        cells.sort((a, b) => a.d - b.d);
        const mat = n.kind === 'smoke'
          ? new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
          : new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
        const mesh = new THREE.InstancedMesh(n.kind === 'smoke' ? this.puff : this.flame, mat, Math.max(1, cells.length));
        const m = new THREE.Matrix4(), c = new THREE.Color();
        cells.forEach((p, i) => {
          if (n.kind === 'smoke') {
            // Bouffées : légèrement décalées et de tailles variées, pour un volume moins « cubique »
            const h = (k: number) => (((i + 1) * k) % 1000) / 1000 - 0.5;
            const sc = 0.85 + (h(7919) + 0.5) * 0.45;
            m.makeScale(sc, sc, sc).setPosition((p.x + h(104729) * 6) * S, (p.z + h(1299709) * 6) * S, -(p.y + h(15485863) * 6) * S);
          } else m.makeTranslation(p.x * S, (p.z + 1) * S, -p.y * S);
          mesh.setMatrixAt(i, m);
          // Fumée : gris clair légèrement varié ; feu : du rouge au orange
          if (n.kind === 'smoke') { const g = 0.76 + ((i * 2654435761) % 1000) / 1000 * 0.14; c.setRGB(g, g, g); }
          else c.setHSL(0.02 + ((i * 40503) % 100) / 100 * 0.07, 0.95, 0.5);
          mesh.setColorAt(i, c);
        });
        mesh.count = 0;
        mesh.frustumCulled = false; // l'enveloppe change pendant la propagation
        it.fx = mesh; it.cells = cells; it.maxD = cells.length ? cells[cells.length - 1].d : 1; it.mat = mat;
        this.group.add(mesh);
      }
      const mesh = it.fx as THREE.InstancedMesh, cells = it.cells!;
      // Front de propagation : la fumée s'étend en ~1 s, le feu en ~1,5 s ; fondu de fin
      const grow = n.kind === 'smoke' ? 1.0 : 1.5;
      const k = Math.min(1, e.elapsed / grow), front = (it.maxD ?? 1) * (1 - (1 - k) ** 2);
      let lo = 0, hi = cells.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cells[mid].d <= front) lo = mid + 1; else hi = mid; }
      mesh.count = Math.max(0, lo);
      const fade = n.kind === 'smoke' ? Math.min(1, e.remaining / 1.5) : Math.min(1, e.remaining / 0.8);
      (it.mat as THREE.MeshLambertMaterial).opacity = (n.kind === 'smoke' ? 1 : 0.85) * fade;
      (it.mat as THREE.Material).depthWrite = n.kind === 'smoke' && fade > 0.98;
      if (n.kind === 'molotov') {
        // Flammes qui vacillent
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
          const f = 0.6 + 0.5 * Math.abs(Math.sin(this.clock * (5 + (i % 7)) + i));
          sc.set(1, f, 1);
          mesh.setMatrixAt(i, m.compose(p, q, sc));
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.visible = true;
      return;
    }
    // Repli (avant chargement de la carte) et éclats : formes simples
    if (!it.fx) {
      const r = RADIUS[n.kind] * S;
      const fx = n.kind === 'smoke' ? new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshLambertMaterial({ color: 0xd9d9d9, transparent: true, opacity: 0.55, depthWrite: false }))
        : n.kind === 'molotov' ? new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }))
          : new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), this.burstMat.clone());
      if (n.kind === 'molotov') fx.rotation.x = -Math.PI / 2;
      it.fx = fx;
      this.group.add(fx);
    }
    const fx = it.fx as THREE.Mesh;
    fx.position.set(e.x * S, (e.z + (n.kind === 'molotov' ? 2 : n.kind === 'smoke' ? 40 : 30)) * S, -e.y * S);
    if (n.kind === 'smoke') fx.scale.setScalar(0.4 + 0.6 * Math.min(1, e.t * 8));
    else if (n.kind === 'molotov') fx.scale.setScalar(0.6 + 0.4 * Math.min(1, e.t * 6));
    else { fx.scale.setScalar(0.3 + 0.7 * e.t); (fx.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - e.t); }
    fx.visible = true;
  }
}

export interface ShotVisual { id: number; from: [number, number, number]; to: [number, number, number]; age: number }

/** Tirs : traçante de l'arme au point d'impact (joueur touché ou mur), éclair au canon. */
export class ShotLayer {
  readonly group = new THREE.Group();
  private lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false }));
  private flash: THREE.InstancedMesh;
  private impact: THREE.InstancedMesh;
  constructor() {
    this.flash = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6 * S, 0), new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0.95 }), 64);
    this.impact = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2 * S, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), 64);
    this.flash.frustumCulled = this.impact.frustumCulled = this.lines.frustumCulled = false;
    this.group.add(this.lines, this.flash, this.impact);
  }
  update(list: ShotVisual[]): void {
    const n = Math.min(64, list.length);
    const pos = new Float32Array(n * 6), col = new Float32Array(n * 6);
    const m = new THREE.Matrix4();
    let nf = 0, ni = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const a = Math.max(0, 1 - s.age / 0.14); // la traçante s'éteint en 0,14 s
      pos.set([s.from[0] * S, s.from[2] * S, -s.from[1] * S, s.to[0] * S, s.to[2] * S, -s.to[1] * S], i * 6);
      col.set([1 * a, 0.92 * a, 0.7 * a, 0.5 * a, 0.5 * a, 0.5 * a], i * 6);
      if (s.age < 0.06) { m.makeTranslation(s.from[0] * S, s.from[2] * S, -s.from[1] * S); this.flash.setMatrixAt(nf++, m); }
      if (s.age < 0.2) { m.makeTranslation(s.to[0] * S, s.to[2] * S, -s.to[1] * S); this.impact.setMatrixAt(ni++, m); }
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.flash.count = nf; this.impact.count = ni;
    this.flash.instanceMatrix.needsUpdate = this.impact.instanceMatrix.needsUpdate = true;
  }
}
