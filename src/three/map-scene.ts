// Scène 3D d'une carte : sols réels (nav mesh) texturés avec le radar, murs extrudés sur les bords,
// marches, et couches optionnelles : densité (heatmap), points d'événements, joueurs du replay.
// Rendu à la demande (pas de boucle continue quand rien ne bouge).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getMap, isLower, radarUrl, RADAR_SIZE, worldToRadar, type MapCalibration } from '@/maps/maps';
import { densityField, type DensitySettings } from '@/analysis/density';
import { rampColor, type RampId } from '@/analysis/ramps';
import { hasNav } from './nav-maps';
import { fireSpread, raycast, smokeVolume, TriIndex } from './volumes';
import { animateFigure, chooseClip, makeAnimatedFigure, type AnimatedFigure, type Rig } from './rig';
import { figureColor, makeFigure, NadeLayer, poseFigure, setFigureWeapon, ShotLayer, type Figure, type NadeVisual, type Pose, type ShotVisual } from './actors';

/** Échelle monde -> scène (les unités CS sont grandes). */
const S = 1 / 32;

/** Modèle d'une carte : maillage de collision du jeu (préparé par scripts/build-geometry.mjs). */
export interface MapGeometry {
  /** Positions monde (x, y, z) de chaque sommet. */
  pos: Float32Array;
  floor: Uint32Array; // triangles des sols (normale vers le haut)
  wall: Uint32Array;  // triangles des murs, toits inclinés, objets
  /** Parties fines à transparence dans le jeu (grillages, rambardes, feuillages, vitres) : dessinées translucides. */
  alpha: Uint32Array;
  /** Couleur moyenne du matériau par sommet (export Source 2 Viewer), null pour la collision. */
  col: Uint8Array | null;
  minZ: number;
  maxZ: number;
}

const geoCache = new Map<string, Promise<MapGeometry | null>>();

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  // Certains hébergeurs décompressent déjà (Content-Encoding) : on ne décompresse que si besoin
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export function decodeGeometry(buf: ArrayBuffer): MapGeometry {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'GEO2' && magic !== 'GEO3' && magic !== 'GEO4') throw new Error('bad geometry file');
  const v3 = magic !== 'GEO2', v4 = magic === 'GEO4';
  const nv = dv.getUint32(4, true), nf = dv.getUint32(8, true), nw = dv.getUint32(12, true);
  // GEO4 : nombre de triangles translucides avant les options
  const na = v4 ? dv.getUint32(16, true) : 0;
  const flags = v3 ? dv.getUint32(v4 ? 20 : 16, true) : 0;
  const h = v4 ? 24 : v3 ? 20 : 16;
  const min = [0, 1, 2].map((j) => dv.getFloat32(h + j * 4, true)), max = [0, 1, 2].map((j) => dv.getFloat32(h + 12 + j * 4, true));
  let off = h + 24;
  const q = new Uint16Array(buf.slice(off, off + nv * 6));
  off += nv * 6;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) { const j = i % 3; pos[i] = min[j] + (q[i] / 65535) * (max[j] - min[j]); }
  let col: Uint8Array | null = null;
  if (flags & 1) { col = new Uint8Array(buf.slice(off, off + nv * 3)); off += nv * 3 + ((4 - ((nv * 3) % 4)) % 4); }
  const idx = new Uint32Array(buf.slice(off, off + (nf + nw + na) * 12));
  return { pos, floor: idx.subarray(0, nf * 3), wall: idx.subarray(nf * 3, (nf + nw) * 3), alpha: idx.subarray((nf + nw) * 3), col, minZ: min[2], maxZ: max[2] };
}

export function loadGeometry(map: string): Promise<MapGeometry | null> {
  if (!hasNav(map)) return Promise.resolve(null);
  let p = geoCache.get(map);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}geo/${map}.bin.gz`).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then(async (b) => (b ? decodeGeometry(await gunzip(b)) : null)).catch(() => null);
    geoCache.set(map, p);
  }
  return p;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x * S, z * S, -y * S);

/** Radar en niveaux de gris assombris (même rendu que les heatmaps 2D), plaqué sur les sols. */
function greyRadar(url: string): Promise<THREE.Texture | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = RADAR_SIZE;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, RADAR_SIZE, RADAR_SIZE);
      ctx.filter = 'grayscale(1) brightness(0.55) contrast(1.1)';
      ctx.drawImage(img, 0, 0, RADAR_SIZE, RADAR_SIZE);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      res(t);
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

/**
 * Sous-maillage indexé (sommets partagés : deux fois moins de mémoire qu'en triangles séparés), avec
 * UV du radar pour les sols et une teinte selon la hauteur (les étages hauts plus clairs : lecture du relief).
 */
function subGeometry(g: MapGeometry, tris: ArrayLike<number>, cal: MapCalibration | null, shade = true): THREE.BufferGeometry {
  const remap = new Map<number, number>();
  const index = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    let r = remap.get(tris[i]);
    if (r === undefined) { r = remap.size; remap.set(tris[i], r); }
    index[i] = r;
  }
  const n = remap.size;
  const pos = new Float32Array(n * 3), col = shade ? new Float32Array(n * 3) : null, uv = cal ? new Float32Array(n * 2) : null;
  const span = Math.max(1, g.maxZ - g.minZ);
  for (const [v0, i] of remap) {
    const v = v0 * 3, x = g.pos[v], y = g.pos[v + 1], z = g.pos[v + 2];
    pos[i * 3] = x * S; pos[i * 3 + 1] = z * S; pos[i * 3 + 2] = -y * S;
    if (col) {
      const t = Math.min(1, Math.max(0, (z - g.minZ) / span)), k = 0.62 + 0.38 * t * (2 - t);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; // monochrome (direction artistique), même si l'export a des couleurs
    }
    if (uv && cal) { const [rx, ry] = worldToRadar(cal, x, y); uv[i * 2] = rx / RADAR_SIZE; uv[i * 2 + 1] = 1 - ry / RADAR_SIZE; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Sélectionne des triangles d'une liste d'indices selon leur centre. */
function pickTris(g: MapGeometry, tris: Uint32Array, test: (x: number, y: number, z: number) => boolean): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 3; j++) { const v = tris[i + j] * 3; x += g.pos[v]; y += g.pos[v + 1]; z += g.pos[v + 2]; }
    if (test(x / 3, y / 3, z / 3)) out.push(tris[i], tris[i + 1], tris[i + 2]);
  }
  return Uint32Array.from(out);
}

/** Texture de densité dans l'espace du radar (se superpose exactement aux sols). */
function heatTexture(pts: [number, number][], ramp: RampId, d: DensitySettings): THREE.CanvasTexture {
  const n = 512;
  const field = densityField(pts, n, d, RADAR_SIZE);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v <= d.threshold) continue;
    const e = Math.min(1, (v - d.threshold) / 0.12);
    const [r, g, b] = rampColor(ramp, ramp === 'mono' ? 0.35 + 0.65 * v : v);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(255 * d.opacity * e * e * (3 - 2 * e) * (0.5 + 0.5 * v));
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Player3D { id: number; x: number; y: number; z: number; yaw: number; ct: boolean; alive: boolean; name: string; followed?: boolean; weapon?: string; pose?: Pose }

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = '600 28px Geist Variable, system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w; c.height = 40;
  ctx.font = '600 28px Geist Variable, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(10,10,10,0.75)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, 40, 8); ctx.fill();
  ctx.fillStyle = '#fafafa';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 21);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
  sp.scale.set((w / 40) * 0.02, 0.02, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  return sp;
}

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private heat = new THREE.Group();
  private players = new Map<number, { group: THREE.Group; ring: THREE.Mesh; label: THREE.Sprite; inner: THREE.Object3D; fig?: Figure; anim?: AnimatedFigure; lastTime: number }>();
  private rig: Rig | null = null;
  private nades = new NadeLayer();
  private shots = new ShotLayer();
  private tri: TriIndex | null = null;
  private decal = new THREE.Group();
  private floorTris: { upper: Uint32Array; lower: Uint32Array } = { upper: new Uint32Array(), lower: new Uint32Array() };
  private geo: MapGeometry | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  /** Hauteur de coupe (monde) : tout ce qui est au-dessus est masqué (toits, plafonds). */
  cutZ: number | null = null;
  zRange: [number, number] = [0, 0];
  private cal: MapCalibration | null = null;
  private ro: ResizeObserver;
  private frame = 0;
  private disposed = false;
  center = new THREE.Vector3();
  /** Appelé après chaque rendu (ex. mise à jour de l'interface). */
  onRender?: () => void;

  private container: HTMLElement;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.4);

  private floorMats: THREE.MeshLambertMaterial[] = [];
  private radarFloors = true;

  /** Image du radar (en gris) sur les sols, ou sols unis. */
  setRadarFloors(on: boolean): void { this.radarFloors = on; this.applyRadarFloors(); this.render(); }
  private applyRadarFloors(): void {
    for (const m of this.floorMats) {
      const t = this.radarFloors ? (m.userData.radar as THREE.Texture | null) : null;
      m.map = t;
      m.color.setHex(t ? 0xffffff : 0x8f8f8f);
      m.needsUpdate = true;
    }
  }

  /** Débogage local et tests : classes three.js. */
  readonly THREE = THREE;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); // ajusté par setQuality()
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    this.scene.background = new THREE.Color(bg && !bg.startsWith('oklch') ? bg : '#171717');
    this.scene.add(this.hemi);
    this.sun.position.set(-60, 120, 40);
    this.scene.add(this.sun);
    this.scene.add(this.root, this.heat, this.decal, this.nades.group, this.shots.group);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 400;
    // Zoom vers le pointeur de la souris (comme une carte), pas seulement vers le centre
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.render());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  resize(): void {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = `${r.width}px`;
    this.renderer.domElement.style.height = `${r.height}px`;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Charge la carte ; false si aucun modèle 3D n'existe pour elle. */
  async load(map: string): Promise<boolean> {
    const cal = getMap(map);
    const g = await loadGeometry(map);
    if (this.disposed || !g || !cal) return false;

    this.cal = cal;
    this.geo = g;
    this.root.clear();
    const lower = (z: number) => isLower(cal, z);
    const upperTris = pickTris(g, g.floor, (_x, _y, z) => !lower(z)), lowerTris = cal.hasLower ? pickTris(g, g.floor, (_x, _y, z) => lower(z)) : new Uint32Array();
    if (this.disposed) return false;
    const clipping = [this.clip];
    const colored = false;
    // Sols : radar en gris plaqué dessus (par défaut) ou maquette unie, au choix (setRadarFloors)
    const [texU, texL] = await Promise.all([greyRadar(radarUrl(map)), lowerTris.length ? greyRadar(radarUrl(map, true)) : Promise.resolve(null)]);
    if (this.disposed) return false;
    this.floorMats = [];
    const floorMat = (t: THREE.Texture | null) => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: clipping });
      m.userData.radar = t;
      this.floorMats.push(m);
      return m;
    };
    this.floorTris = { upper: upperTris, lower: lowerTris };
    this.root.add(new THREE.Mesh(subGeometry(g, upperTris, cal), floorMat(texU)));
    if (lowerTris.length) this.root.add(new THREE.Mesh(subGeometry(g, lowerTris, cal), floorMat(texL ?? texU)));
    const wallGeo = subGeometry(g, g.wall, null);
    this.root.add(new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ color: colored ? 0xffffff : 0x6a6a6a, vertexColors: true, flatShading: true, side: THREE.DoubleSide, clippingPlanes: clipping })));
    // Arêtes vives (angles > 40°) : silhouette nette des volumes, comme une maquette
    // Grillages, rambardes, feuillages, vitres : translucides (sans texture, un aplat opaque masquerait la vue)
    if (g.alpha.length) {
      const alphaGeo = subGeometry(g, g.alpha, null);
      const m = new THREE.MeshLambertMaterial({ color: 0x9a9a9a, vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clipping });
      const mesh = new THREE.Mesh(alphaGeo, m);
      mesh.renderOrder = 1;
      mesh.userData.noPick = true; // les dessins se posent au sol, pas sur un grillage
      this.root.add(mesh);
    }
    // (cartes complètes très lourdes : on s'en passe, le calcul bloquerait plusieurs secondes)
    if (g.wall.length / 3 < 1_200_000) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo, 40), new THREE.LineBasicMaterial({ color: colored ? 0x000000 : 0xd4d4d4, transparent: true, opacity: colored ? 0.18 : 0.22, clippingPlanes: clipping }));
      this.root.add(edges);
    }
    this.applyRadarFloors();
    this.zRange = [g.minZ, g.maxZ];
    // Propagation des fumées et des feux dans cette géométrie (calcul à la demande, une fois par grenade)
    const tri = new TriIndex(g.pos, g.floor, g.wall);
    this.tri = tri;
    this.nades.volumes = { smoke: (x, y, z) => smokeVolume(tri, x, y, z), fire: (x, y, z) => fireSpread(tri, x, y, z) };
    this.setCut(this.cutZ);
    // Cadrage
    const box = new THREE.Box3().setFromObject(this.root);
    box.getCenter(this.center);
    const size = box.getSize(new THREE.Vector3());
    this.controls.target.copy(this.center);
    const d = Math.max(size.x, size.z) * 0.95;
    // Limites de zoom et plans de caméra à l'échelle du modèle (sinon zoom bloqué sur les grandes cartes)
    this.controls.maxDistance = Math.max(50, d * 3);
    this.camera.near = Math.max(0.05, d / 5000);
    this.camera.far = Math.max(2000, d * 10);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.center.x - d * 0.35, this.center.y + d * 0.85, this.center.z + d * 0.6);
    this.controls.update();
    this.render();
    return true;
  }

  /** Coupe proposée d'après les hauteurs jouées : seulement si beaucoup de géométrie les domine (tours, étages). */
  suggestCut(zs: number[]): number | null {
    if (!zs.length) return null;
    const sorted = [...zs].sort((a, b) => a - b);
    const top = sorted[Math.floor(sorted.length * 0.97)];
    return this.zRange[1] - top > 700 ? top + 320 : null;
  }

  /** Coupe horizontale (null : aucune) pour voir sous les toits. */
  setCut(z: number | null): void {
    this.cutZ = z;
    this.clip.constant = z === null ? 1e6 : z * S;
    this.render();
  }

  /** Densité posée sur les sols (sépare les niveaux supérieur / inférieur si la carte en a deux). */
  setHeat(points: { x: number; y: number; z: number }[], ramp: RampId, d: DensitySettings, showDots: boolean): void {
    const cal = this.cal;
    if (!cal) return;
    for (const m of this.heat.children) disposeObject(m);
    this.heat.clear();
    const g = this.geo;
    if (!g) return;
    // Plage de hauteurs des événements par case de 96 unités (élargie aux voisines) : la densité ne se
    // pose que sur les sols à la hauteur des événements, pas sur les toits au-dessus
    const C = 96, zr = new Map<string, [number, number]>();
    const r = Math.ceil((d.radius * cal.scale * 1.5) / C);
    for (const p of points) {
      const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const k = `${cx + dx},${cy + dy}`, v = zr.get(k);
        if (v) { v[0] = Math.min(v[0], p.z); v[1] = Math.max(v[1], p.z); } else zr.set(k, [p.z, p.z]);
      }
    }
    for (const lowerPass of cal.hasLower ? [false, true] : [false]) {
      const pts = points.filter((p) => isLower(cal, p.z) === lowerPass).map((p) => worldToRadar(cal, p.x, p.y));
      if (!pts.length) continue;
      const tris = pickTris(g, g.floor, (x, y, z) => {
        if (isLower(cal, z) !== lowerPass) return false;
        const v = zr.get(`${Math.floor(x / C)},${Math.floor(y / C)}`);
        return !!v && z >= v[0] - 90 && z <= v[1] + 90;
      });
      if (!tris.length) continue;
      const overlay = new THREE.Mesh(subGeometry(g, tris, cal, false), new THREE.MeshBasicMaterial({ map: heatTexture(pts, ramp, d), transparent: true, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [this.clip], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }));
      overlay.renderOrder = 2;
      this.heat.add(overlay);
    }
    if (showDots && points.length) {
      const [r, g, b] = rampColor(ramp, 0.9);
      const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshLambertMaterial({ color: new THREE.Color(r / 255, g / 255, b / 255) }), points.length);
      const m = new THREE.Matrix4();
      points.forEach((p, i) => { m.makeTranslation(p.x * S, (p.z + 36) * S, -p.y * S); mesh.setMatrixAt(i, m); });
      this.heat.add(mesh);
    }
    this.render();
  }

  /** Joueurs (replay) : capsule, direction du regard, nom. */
  setPlayers(list: Player3D[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let e = this.players.get(p.id);
      // Rig animé (vraies animations) dès qu'il est disponible ; sinon silhouette procédurale
      const wantAnim = !!this.rig;
      if (e && !!e.anim !== wantAnim) { this.scene.remove(e.group); this.players.delete(p.id); e = undefined; }
      if (!e) {
        const lb = label(p.name);
        if (this.rig) {
          const anim = makeAnimatedFigure(this.rig, p.ct);
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.05;
          lb.position.y = 78 * S;
          const group = new THREE.Group();
          group.add(anim.group, ring, lb);
          e = { group, ring, label: lb, inner: anim.group, anim, lastTime: p.pose?.time ?? 0 };
        } else {
          const fig = makeFigure(p.ct, lb);
          e = { group: fig.group, ring: fig.ring, label: lb, inner: fig.body, fig, lastTime: 0 };
        }
        this.scene.add(e.group);
        this.players.set(p.id, e);
      }
      e.group.visible = p.alive;
      e.group.position.set(p.x * S, p.z * S, -p.y * S);
      e.inner.rotation.y = (p.yaw * Math.PI) / 180;
      e.ring.visible = !!p.followed;
      if (e.fig) {
        e.fig.mat.color.setHex(figureColor(p.ct));
        setFigureWeapon(e.fig, p.weapon ?? '');
        if (p.pose) poseFigure(e.fig, p.pose);
      } else if (e.anim && this.rig && p.pose) {
        e.anim.mat.color.setHex(figureColor(p.ct));
        const dt = p.pose.time - e.lastTime;
        e.lastTime = p.pose.time;
        animateFigure(this.rig, e.anim, chooseClip(this.rig, { ...p.pose, yaw: p.yaw }, p.weapon ?? ''), p.weapon ?? '', dt > 0 && dt < 1 ? dt : 0, p.pose.overlay ?? null);
      }
    }
    for (const [id, e] of this.players) if (!seen.has(id)) e.group.visible = false;
    this.render();
  }

  /** Active les vraies animations des joueurs (paquet préparé par npm run anims:extract). */
  setRig(rig: Rig | null): void {
    this.rig = rig;
  }

  /** Tirs en cours (traçantes). */
  setShots(list: ShotVisual[]): void { this.shots.update(list); this.render(); }

  /** Distance au premier obstacle de la carte le long d'un rayon (monde). */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD = 3000): number {
    return this.tri ? raycast(this.tri, ox, oy, oz, dx, dy, dz, maxD) : maxD;
  }

  /** Grenades en vol et effets (fumées, feux, éclats). */
  setNades(list: NadeVisual[]): void {
    this.nades.update(list);
    this.render();
  }

  /**
   * Calque dessiné sur les sols (annotations du scrim, zones du coach), dans l'espace du radar :
   * un canvas par niveau (null : rien sur ce niveau).
   */
  setDecal(upper: HTMLCanvasElement | null, lower: HTMLCanvasElement | null): void {
    const g = this.geo, cal = this.cal;
    for (const m of this.decal.children) disposeObject(m);
    this.decal.clear();
    if (!g || !cal) return;
    for (const [canvas, tris] of [[upper, this.floorTris.upper], [lower, this.floorTris.lower]] as const) {
      if (!canvas || !tris.length) continue;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const m = new THREE.Mesh(subGeometry(g, tris, cal, false), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [this.clip], polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
      m.renderOrder = 3;
      this.decal.add(m);
    }
    this.render();
  }

  /** Point du sol sous le pointeur (coordonnées monde), pour dessiner en 3D. */
  pickFloor(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.root.children.filter((o) => o instanceof THREE.Mesh && !o.userData.noPick), false)
      .filter((h) => this.cutZ === null || h.point.y <= this.cutZ * S);
    const h = hits[0];
    return h ? { x: h.point.x / S, y: -h.point.z / S, z: h.point.y / S } : null;
  }

  /** Mode dessin : le clic gauche dessine au lieu de tourner la caméra (clic droit : déplacer). */
  setDrawing(on: boolean): void {
    this.controls.enableRotate = !on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  /** Recentre la caméra sur un point du monde (suivi d'un joueur). */
  follow(x: number, y: number, z: number, zoomIn = false): void {
    const t = v3(x, y, z);
    if (zoomIn) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(t);
      this.camera.position.copy(t).addScaledVector(dir, 55);
      this.controls.update();
      return;
    }
    const delta = t.clone().sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
  }

  reset(): void {
    if (!this.cal) return;
    const box = new THREE.Box3().setFromObject(this.root);
    const size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.z) * 0.95;
    this.controls.target.copy(this.center);
    this.camera.position.set(this.center.x - d * 0.35, this.center.y + d * 0.85, this.center.z + d * 0.6);
    this.controls.update();
  }

  /** Vue de dessus (comme le radar). */
  topDown(): void {
    const box = new THREE.Box3().setFromObject(this.root);
    const size = box.getSize(new THREE.Vector3());
    this.controls.target.copy(this.center);
    this.camera.position.set(this.center.x, this.center.y + Math.max(size.x, size.z) * 1.25, this.center.z + 0.01);
    this.controls.update();
  }

  render(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      if (this.controls.update()) this.render(); // amortissement en cours
      // Joueurs toujours lisibles de loin : taille minimale à l'écran
      const k = Math.max(1, this.camera.position.distanceTo(this.controls.target) / 70);
      for (const e of this.players.values()) { e.inner.scale.setScalar(k); e.ring.scale.setScalar(k); e.label.position.y = 78 * S * k; }
      this.renderer.render(this.scene, this.camera);
      // Écart entre deux images consécutives (lecture, rotation) : reflète aussi le temps GPU

      this.onRender?.();
    });
  }

  // Qualité adaptative : si les images sont lentes, on réduit la résolution de rendu (puis l'anticrénelage n'a plus besoin d'autant)
  // Qualité d'image : choisie une fois (réglage, ou mesure au chargement en « Auto ») puis fixe.
  // Elle ne change plus en cours de route (avant : la résolution baissait d'un coup en dessinant).
  private calibrating = false;
  private calib: number[] = [];
  /** 'auto' : mesure sur quelques images au chargement ; 'high' : pleine définition ; 'performance' : allégée. */
  setQuality(q: 'auto' | 'high' | 'performance'): void {
    const dpr = window.devicePixelRatio || 1;
    if (q === 'high') { this.calibrating = false; this.applyPixelRatio(Math.min(2, dpr)); return; }
    if (q === 'performance') { this.calibrating = false; this.applyPixelRatio(Math.min(1, dpr) * 0.75); return; }
    this.applyPixelRatio(Math.min(1.5, dpr));
    this.calibrating = true;
    this.calib = [];
    this.renderBurst(32);
  }
  private applyPixelRatio(pr: number): void {
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 0.01) return;
    this.renderer.setPixelRatio(pr);
    this.resize();
  }
  /** Rendus consécutifs forcés, chronométrés (mesure de la qualité automatique), puis décision définitive. */
  private renderBurst(n: number): void {
    let left = n;
    const step = (ts: number) => {
      if (this.disposed || !this.calibrating) return;
      this.calib.push(ts);
      this.renderer.render(this.scene, this.camera);
      // 32 images ou 1,5 s au plus : la décision tombe vite, avant qu'on commence à jouer ou à dessiner
      if (--left > 0 && ts - this.calib[0] < 1500) requestAnimationFrame(step); else this.finishCalibration();
    };
    requestAnimationFrame(step);
  }
  private finishCalibration(): void {
    this.calibrating = false;
    if (this.calib.length < 4) return;
    const t = this.calib, gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
    const ms = gaps[Math.floor(gaps.length / 2)]; // médiane : insensible aux à-coups du chargement
    const dpr = window.devicePixelRatio || 1;
    this.applyPixelRatio(ms < 14 ? Math.min(1.5, dpr) : ms < 24 ? Math.min(1, dpr) : 0.75);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
  });
}
