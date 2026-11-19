// Joueurs animés avec les vraies animations de CS2 (paquet préparé par npm run anims:extract) :
// squelette du jeu, clips de repos / marche / course / accroupi par type d'arme, pose, défuse.
// Corps : celui de l'agent s'il a pu être exporté, sinon un mannequin monochrome posé sur les os.
// Sans paquet, la vue 3D garde les silhouettes procédurales (actors.ts).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { iconFor } from '@/assets/icons';
import { S, weaponGeometry, type Pose } from './actors';

export interface RigPack { version: number; unitScale: number; roots: string[]; bones: string[]; bodies: string[]; clips: object[] }

export interface Rig {
  pack: RigPack;
  clips: Map<string, THREE.AnimationClip>;
  skeleton: THREE.Object3D;
  bodies: Partial<Record<'ct' | 't', THREE.Object3D>>;
  /** Rotation (radians) qui ramène l'avant du modèle vers +X de la scène. */
  yawOffset: number;
}

/** Dossier des animations propres à une arme (rifle_ak, pistol_glock…). */
const WEAPON_FOLDER: Record<string, string> = {
  ak47: 'rifle_ak', m4a4: 'rifle_m4a4', m4a1: 'rifle_m4a1_silencer', 'm4a1-silencer-off': 'rifle_m4a1_silencer', awp: 'rifle_awp', aug: 'rifle_aug', famas: 'rifle_famas',
  galilar: 'rifle_galilar', sg553: 'rifle_sg556', ssg08: 'rifle_ssg08', g3sg1: 'rifle_g3sg1', scar20: 'rifle_scar', mac10: 'rifle_mac10', mp9: 'rifle_mp9', mp7: 'rifle_mp7',
  mp5sd: 'rifle_mp5sd', ump45: 'rifle_ump45', p90: 'rifle_p90', bizon: 'rifle_bizon', nova: 'rifle_nova', xm1014: 'rifle_xm1014', mag7: 'rifle_mag7', 'sawed-off': 'rifle_sawedoff',
  m249: 'rifle_m249', negev: 'rifle_negev', glock: 'pistol_glock', usps: 'pistol_usp', 'usps-silencer-off': 'pistol_usp', p2000: 'pistol_hkp2000', p250: 'pistol_p250',
  'five-seven': 'pistol_fiveseven', tec9: 'pistol_tec9', cz75a: 'pistol_cz75a', deagle: 'pistol_deagle', revolver: 'pistol_revolver', 'dual-elite': 'pistol_elite', zeus: 'pistol_taser',
};
export const weaponFolder = (weapon: string) => WEAPON_FOLDER[iconFor(weapon) ?? ''] ?? '';

/** Os du haut du corps (le premier os de colonne et tout ce qui est au-dessus) : sortie, rechargement, tir. */
function upperBones(root: THREE.Object3D): Set<string> {
  let spine: THREE.Object3D | null = null;
  root.traverse((o) => { if (!spine && /spine/i.test(o.name)) spine = o; });
  const out = new Set<string>();
  (spine as THREE.Object3D | null)?.traverse((o) => out.add(o.name));
  return out;
}

let rigPromise: Promise<Rig | null> | null = null;

async function gunzipJson(buf: ArrayBuffer): Promise<unknown> {
  const b = new Uint8Array(buf);
  const raw = b[0] === 0x1f && b[1] === 0x8b ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(b);
  return JSON.parse(raw);
}

const loadGlb = (url: string) => new Promise<THREE.Object3D | null>((res) => new GLTFLoader().load(url, (g) => res(g.scene), undefined, () => res(null)));

/** Charge le paquet d'animations une fois (null s'il n'a pas été préparé). */
export function loadRig(): Promise<Rig | null> {
  rigPromise ??= (async () => {
    const base = `${import.meta.env.BASE_URL}anim/`;
    try {
      const r = await fetch(`${base}players.json.gz`);
      // (le serveur de dev renvoie la page de l'appli pour un fichier absent)
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('html')) return null;
      const pack = (await gunzipJson(await r.arrayBuffer())) as RigPack;
      const skeleton = await loadGlb(`${base}skeleton.glb`);
      if (!skeleton) return null;
      const bodies: Rig['bodies'] = {};
      for (const side of pack.bodies as ('ct' | 't')[]) { const b = await loadGlb(`${base}body_${side}.glb`); if (b) bodies[side] = b; }
      return buildRig(pack, skeleton, bodies);
    } catch (e) { console.warn('player models: could not load public/anim/', e); return null; }
  })();
  return rigPromise;
}

/** Assemble le rig (séparé du chargement : testable sans réseau). */
export function buildRig(pack: RigPack, skeleton: THREE.Object3D, bodies: Rig['bodies'] = {}): Rig {
  const upper = upperBones(skeleton);
  const clips = new Map(pack.clips.map((c) => {
    const clip = THREE.AnimationClip.parse(c as Parameters<typeof THREE.AnimationClip.parse>[0]);
    // Sortie, rechargement, tir : haut du corps seulement (les jambes gardent la marche / la course)
    if (/^(draw|reload|shoot)_/.test(clip.name) && upper.size) clip.tracks = clip.tracks.filter((t) => upper.has(t.name.slice(0, t.name.lastIndexOf('.'))));
    return [clip.name, clip] as const;
  }));
  return { pack, clips, skeleton, bodies, yawOffset: forwardYaw(skeleton) };
}

/** Avant du modèle au repos : de la cheville vers les orteils (sinon on suppose +X, l'avant de Source). */
function forwardYaw(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const pos = (re: RegExp) => { let p: THREE.Vector3 | null = null; root.traverse((o) => { if (!p && re.test(o.name)) p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }); return p as THREE.Vector3 | null; };
  const ankle = pos(/ankle.*_?l$|foot.*_?l$|l_?foot|ankle_l/i), toe = pos(/(ball|toe).*_?l$|l_?toe|ball_l/i);
  if (!ankle || !toe) return 0;
  const d = toe.sub(ankle);
  if (Math.hypot(d.x, d.z) < 1e-4) return 0;
  return Math.atan2(d.z, d.x); // angle de l'avant du modèle autour de Y
}

/** Classe d'animation d'après l'arme en main. */
export function weaponClass(weapon: string): 'rifle' | 'pistol' | 'knife' | 'grenade' {
  const n = iconFor(weapon) ?? '';
  if (/grenade|flashbang|molotov|decoy/.test(n)) return 'grenade';
  if (n === 'knife' || n === '' || /bomb|defuser|zeus/.test(n)) return n === 'knife' ? 'knife' : 'pistol';
  return ['glock', 'usps', 'usps-silencer-off', 'p2000', 'p250', 'five-seven', 'tec9', 'cz75a', 'deagle', 'revolver', 'dual-elite'].includes(n) ? 'pistol' : 'rifle';
}

/** Choix du clip : action (pose, défuse), sinon repos / marche / course / accroupi dans la direction du déplacement. */
export function chooseClip(rig: Rig, p: Pose & { yaw?: number }, weapon: string): { name: string; speed: number } {
  const wc = weaponClass(weapon);
  // Grenade : lancer, ou tenue à l'arrêt ; en mouvement, les jambes du pistolet
  if (p.throwing) return { name: ['throw_overhand_grenade', 'throw_underhand_grenade'].find((n) => rig.clips.has(n)) ?? '', speed: 1 };
  if (wc === 'grenade' && p.speed < 12 && !p.defusing && !p.planting) {
    const n = [p.duck ? 'idle_crouch_grenade' : 'idle_grenade', 'idle_grenade'].find((x) => rig.clips.has(x));
    if (n) return { name: n, speed: 1 };
  }
  const c = wc === 'grenade' ? 'pistol' : wc;
  const has = (n: string) => rig.clips.has(n);
  const pick = (...names: string[]) => names.find(has) ?? '';
  if (p.defusing) return { name: pick(p.duck ? `defuse_crouch_loop_${c}` : `defuse_loop_${c}`, `defuse_loop_rifle`), speed: 1 };
  if (p.planting) return { name: pick(p.duck ? 'planting_crouch' : 'planting', 'planting'), speed: 1 };
  // Saut : impulsion puis phase en l'air
  if (p.air === 'rise') return { name: pick(`jump_stand_${c}`, `inair_stand_${c}`, `idle_${c}`), speed: 1 };
  if (p.air === 'fall') return { name: pick(p.speed > 60 ? `inair_n_${c}` : `inair_stand_${c}`, `inair_stand_${c}`, `idle_${c}`), speed: 1 };
  if (p.speed < 12) return { name: pick(p.duck ? `idle_crouch_${c}` : `idle_${c}`, `idle_${c}`, 'idle_rifle'), speed: 1 };
  // Direction du déplacement par rapport au regard : n avant, s arrière, e droite, w gauche
  let rel = ((p.moveYaw ?? 0) - (p.yaw ?? 0)) % 360;
  if (rel > 180) rel -= 360;
  if (rel < -180) rel += 360;
  const dir = Math.abs(rel) <= 45 ? 'n' : Math.abs(rel) >= 135 ? 's' : rel > 0 ? 'w' : 'e';
  if (p.duck) return { name: pick(`crouch_${dir}_${c}`, `crouch_n_${c}`, `idle_crouch_${c}`), speed: Math.max(0.5, Math.min(1.6, p.speed / 85)) };
  const run = p.speed > 160;
  return { name: pick(`${run ? 'run' : 'walk'}_${dir}_${c}`, `${run ? 'run' : 'walk'}_n_${c}`, `run_n_${c}`, `idle_${c}`), speed: Math.max(0.5, Math.min(1.6, p.speed / (run ? 230 : 130))) };
}

// --- Mannequin : segments monochromes entre chaque os et ses enfants ---

function mannequin(skel: THREE.Object3D, bones: Set<string>, mat: THREE.Material, unitScale: number): void {
  skel.updateMatrixWorld(true);
  const list: THREE.Object3D[] = [];
  skel.traverse((o) => { if (bones.has(o.name)) list.push(o); });
  for (const b of list) {
    const kids = b.children.filter((c) => bones.has(c.name));
    const n = b.name.toLowerCase();
    if (/head/.test(n) && !/neck/.test(n)) {
      const head = new THREE.Mesh(new THREE.SphereGeometry(5.5 / unitScale, 12, 10), mat); // rayon ~5,5 unités du jeu
      b.add(head);
      continue;
    }
    for (const k of kids) {
      // Segment du parent vers l'enfant, dans le repère local du parent
      const local = k.position.clone();
      const len = local.length();
      if (len < 1e-4 || /finger|thumb|index|middle|ring|pinky|twist|helper|offset|weapon|camera|eye|jaw|lid|brow/.test(k.name.toLowerCase())) continue;
      const thick = /spine|pelvis|chest|clavicle/.test(n) ? 0.42 : /thigh|upleg|leg|calf|knee/.test(n) ? 0.28 : /neck/.test(n) ? 0.2 : 0.18;
      const g = new THREE.BoxGeometry(len * thick, len, len * thick);
      g.translate(0, len / 2, 0);
      const m = new THREE.Mesh(g, mat);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local.clone().normalize());
      b.add(m);
    }
  }
}

export interface AnimatedFigure {
  group: THREE.Group;      // placé et tourné par la scène (comme les silhouettes)
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  current: THREE.AnimationAction | null;
  currentName: string;
  overlay: THREE.AnimationAction | null;
  overlayName: string;
  hand: THREE.Object3D | null;
  handL: THREE.Object3D | null;
  weapon: THREE.Mesh;
  weaponName: string;
  mat: THREE.MeshLambertMaterial;
}

const CT = 0xe9e9e9, T = 0x5a5a5a;

export function makeAnimatedFigure(rig: Rig, ct: boolean): AnimatedFigure {
  const mat = new THREE.MeshLambertMaterial({ color: ct ? CT : T });
  const body = rig.bodies[ct ? 'ct' : 't'];
  let model: THREE.Object3D;
  if (body) {
    model = cloneSkinned(body);
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; } });
  } else {
    model = cloneSkinned(rig.skeleton);
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.visible = false; }); // maillage factice de l'export
    mannequin(model, new Set(rig.pack.bones), mat, rig.pack.unitScale);
  }
  // Échelle (mètres -> unités du jeu -> scène) et orientation (avant du modèle vers +X)
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(rig.pack.unitScale * S);
  holder.rotation.y = rig.yawOffset;
  const group = new THREE.Group();
  group.add(holder);
  let hand: THREE.Object3D | null = null, handL: THREE.Object3D | null = null;
  model.traverse((o) => {
    if (!hand && /^hand_?r$|^r_?hand$|hand_r$/i.test(o.name)) hand = o;
    if (!handL && /^hand_?l$|^l_?hand$|hand_l$/i.test(o.name)) handL = o;
  });
  // L'arme suit les mains à chaque image (entre les deux mains pour un fusil), dans le repère du joueur
  const weapon = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide }));
  group.add(weapon);
  return { group, model, mixer: new THREE.AnimationMixer(model), current: null, currentName: '', overlay: null, overlayName: '', hand, handL, weapon, weaponName: '', mat };
}

export interface Overlay { kind: 'draw' | 'reload' | 'shoot'; age: number }

/** Avance l'animation de dt secondes de lecture avec le clip choisi (fondu de 0,2 s au changement),
 * plus éventuellement une action du haut du corps (sortie d'arme, rechargement, tir) à son âge exact. */
export function animateFigure(rig: Rig, f: AnimatedFigure, choice: { name: string; speed: number }, weapon: string, dt: number, overlay: Overlay | null = null): void {
  const oName = overlay ? `${overlay.kind}_${weaponFolder(weapon)}` : '';
  const oClip = oName ? rig.clips.get(oName) : undefined;
  if (oClip && overlay && overlay.age <= oClip.duration) {
    if (f.overlayName !== oName) {
      f.overlay?.stop();
      f.overlay = f.mixer.clipAction(oClip);
      f.overlay.setLoop(THREE.LoopOnce, 1);
      f.overlay.clampWhenFinished = true;
      f.overlay.play();
      f.overlayName = oName;
    }
    // Poids fort (moyenne pondérée du mixer) : le haut du corps suit l'action ; temps calé sur l'événement
    const o = f.overlay as THREE.AnimationAction;
    o.enabled = true;
    o.setEffectiveWeight(8);
    o.time = Math.max(0, overlay.age - Math.max(0, Math.min(0.25, dt)));
  } else if (f.overlay) { f.overlay.stop(); f.overlay = null; f.overlayName = ''; }
  if (choice.name && choice.name !== f.currentName) {
    const clip = rig.clips.get(choice.name);
    if (clip) {
      const next = f.mixer.clipAction(clip);
      next.reset().play();
      if (f.current) f.current.crossFadeTo(next, 0.2, false);
      f.current = next;
      f.currentName = choice.name;
    }
  }
  if (f.current) f.current.timeScale = choice.speed;
  f.mixer.update(Math.max(0, Math.min(0.25, dt)));
  if (weapon !== f.weaponName) {
    f.weaponName = weapon;
    const g = weaponGeometry(weapon);
    f.weapon.visible = !!g && !!f.hand;
    if (g) f.weapon.geometry = g;
  }
  placeWeapon(f, weaponClass(weapon));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();

/** Place l'arme dans les mains : fusil entre les deux mains, canon de la main droite vers la gauche ; sinon dans la main droite, vers l'avant. */
function placeWeapon(f: AnimatedFigure, wc: ReturnType<typeof weaponClass>): void {
  if (!f.hand || !f.weapon.visible) return;
  f.group.updateMatrixWorld(true);
  f.hand.getWorldPosition(_a);
  f.group.worldToLocal(_a);
  let dir: THREE.Vector3;
  if (wc === 'rifle' && f.handL) {
    f.handL.getWorldPosition(_b);
    f.group.worldToLocal(_b);
    _d.subVectors(_b, _a);
    if (_d.length() > 4 * S) {
      dir = _d.normalize();
      f.weapon.position.copy(_a).lerp(_b, 0.5);
    } else { dir = _d.set(1, 0, 0); f.weapon.position.copy(_a); }
  } else {
    dir = _d.set(1, 0, 0);
    f.weapon.position.copy(_a).addScaledVector(dir, wc === 'grenade' ? 0 : 3 * S);
  }
  // Repère de l'arme : +X le long du canon, +Y vers le haut
  const z = new THREE.Vector3().crossVectors(dir, _up);
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, dir).normalize();
  _m.makeBasis(dir, y, z);
  f.weapon.quaternion.setFromRotationMatrix(_m);
}
