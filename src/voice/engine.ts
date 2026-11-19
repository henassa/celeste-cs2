// Lecture de la voix synchronisée avec le replay.
// Les paquets Opus (10 ms) sont décodés par round avec WebCodecs (AudioDecoder, natif dans
// Chrome, Edge et Firefox), regroupés en prises de parole continues, puis programmés dans un
// AudioContext en suivant l'horloge du replay (pause, saut, vitesse).

import type { MatchData } from '../data/types';
import type { Playback } from '../viewer/playback';
import { VOICE_FORMAT_OPUS, type VoiceData } from './types';

const FRAME_SEC = 0.01;
/** Au-delà de cette vitesse, la voix est coupée (incompréhensible). */
export const MAX_VOICE_SPEED = 2;
const LOOKAHEAD = 2;
/** Les voix CS sont enregistrées bas (crêtes vers -30 dBFS) : gain de base, puis compresseur. */
const MAKEUP_GAIN = 3;

export interface Speaker {
  steamid: string;
  player: number;
  name: string;
  packets: number;
  muted: boolean;
  volume: number;
}

interface Segment { speaker: number; start: number; buffer: AudioBuffer }

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'AudioDecoder' in window && 'AudioContext' in window;
}

export class VoiceEngine {
  readonly speakers: Speaker[];
  private solo: number | null = null;
  private readonly match: MatchData;
  private readonly data: VoiceData;
  private readonly pb: Playback;
  /** Index des paquets par orateur, triés par tick. */
  private readonly bySpeaker: number[][];
  private readonly segments = new Map<number, Segment[]>();
  private readonly decoding = new Map<number, Promise<Segment[]>>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: GainNode[] = [];
  private playing = new Map<Segment, AudioBufferSourceNode>();
  private anchor: { ctx: number; game: number; speed: number } | null = null;
  private lastCheck = 0;
  private unsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  masterVolume = 1;
  /** Message d'état pour l'interface. */
  status = '';

  constructor(match: MatchData, data: VoiceData, pb: Playback) {
    this.match = match;
    this.data = data;
    this.pb = pb;
    const ids = [...new Set(data.steamids)];
    this.speakers = ids.map((sid) => {
      const player = match.players.findIndex((p) => p.steamid === sid);
      return { steamid: sid, player, name: player >= 0 ? match.players[player].name : sid, packets: 0, muted: false, volume: 1 };
    }).sort((a, b) => (a.player < 0 ? 99 : match.players[a.player].team * 10 + match.players[a.player].slot) - (b.player < 0 ? 99 : match.players[b.player].team * 10 + match.players[b.player].slot));
    const idx = new Map(this.speakers.map((s, i) => [s.steamid, i]));
    this.bySpeaker = this.speakers.map(() => []);
    for (let i = 0; i < data.ticks.length; i++) {
      if (data.formats[i] !== VOICE_FORMAT_OPUS) continue;
      const s = idx.get(data.steamids[i])!;
      this.bySpeaker[s].push(i);
      this.speakers[s].packets++;
    }
    for (const list of this.bySpeaker) list.sort((a, b) => data.ticks[a] - data.ticks[b]);
  }

  // --- Abonnement de l'interface ---
  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private emit() { this.listeners.forEach((l) => l()); }

  /** Démarre (après un geste de l'utilisateur : obligation des navigateurs pour l'audio). */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.master = this.ctx.createGain();
      // Compresseur : égalise les joueurs qui parlent fort ou bas, évite la saturation
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.gains = this.speakers.map(() => { const g = this.ctx!.createGain(); g.connect(this.master!); return g; });
      this.applyGains();
    }
    await this.ctx.resume();
    this.unsub = this.pb.subscribe(() => this.tick());
    this.tick(true);
  }

  dispose(): void {
    this.unsub?.();
    this.stopAll();
    this.ctx?.close();
    this.ctx = null;
  }

  // --- Mixage ---
  setMuted(i: number, muted: boolean) { this.speakers[i].muted = muted; this.applyGains(); this.emit(); }
  setVolume(i: number, v: number) { this.speakers[i].volume = v; this.applyGains(); this.emit(); }
  setSolo(i: number | null) { this.solo = this.solo === i ? null : i; this.applyGains(); this.emit(); }
  get soloed() { return this.solo; }
  setMaster(v: number) { this.masterVolume = v; if (this.master) this.master.gain.value = v * MAKEUP_GAIN; this.emit(); }
  private applyGains() {
    this.speakers.forEach((s, i) => {
      const g = this.gains[i];
      if (g) g.gain.value = s.muted || (this.solo !== null && this.solo !== i) ? 0 : s.volume;
    });
    if (this.master) this.master.gain.value = this.masterVolume * MAKEUP_GAIN;
  }

  /** Orateurs qui parlent à cet instant (pour l'indicateur). */
  speakingAt(tick: number): Set<number> {
    const out = new Set<number>();
    const ri = this.roundAt(tick);
    const t = tick / this.match.tickrate;
    for (const s of this.segments.get(ri) ?? []) if (t >= s.start && t < s.start + s.buffer.duration) out.add(s.speaker);
    return out;
  }

  /** Joueurs (index dans le match) qui parlent à cet instant. */
  speakingPlayersAt(tick: number): Set<number> {
    const out = new Set<number>();
    for (const i of this.speakingAt(tick)) {
      const s = this.speakers[i];
      if (s.player >= 0 && !s.muted && (this.solo === null || this.solo === i)) out.add(s.player);
    }
    return out;
  }

  private roundAt(tick: number): number {
    const r = this.match.rounds;
    for (let i = r.length - 1; i >= 0; i--) if (tick >= r[i].startTick - 5 * this.match.tickrate) return i;
    return 0;
  }

  // --- Décodage d'un round ---
  private ensureRound(ri: number): Promise<Segment[]> | Segment[] {
    const ready = this.segments.get(ri);
    if (ready) return ready;
    let p = this.decoding.get(ri);
    if (!p) {
      p = this.decodeRound(ri).then((segs) => {
        this.segments.set(ri, segs);
        this.decoding.delete(ri);
        // On garde au plus 4 rounds décodés en mémoire
        if (this.segments.size > 4) {
          const far = [...this.segments.keys()].sort((a, b) => Math.abs(b - ri) - Math.abs(a - ri))[0];
          this.segments.delete(far);
        }
        this.emit();
        return segs;
      });
      this.decoding.set(ri, p);
    }
    return p;
  }

  private async decodeRound(ri: number): Promise<Segment[]> {
    if (!this.ctx) return [];
    const m = this.match, d = this.data, tr = m.tickrate;
    const r = m.rounds[ri];
    const from = ri === 0 ? 0 : r.startTick - 5 * tr;
    const to = m.rounds[ri + 1] ? m.rounds[ri + 1].startTick - 5 * tr : Infinity;
    const out: Segment[] = [];
    for (let s = 0; s < this.speakers.length; s++) {
      const packets = this.bySpeaker[s].filter((i) => d.ticks[i] >= from && d.ticks[i] < to);
      if (!packets.length) continue;
      out.push(...await this.decodeSpeaker(s, packets));
    }
    return out;
  }

  /** Décode les paquets d'un orateur et les regroupe en prises de parole continues. */
  private async decodeSpeaker(speaker: number, packets: number[]): Promise<Segment[]> {
    const d = this.data, tr = this.match.tickrate;
    // Horodatage : chaque frame dure 10 ms ; on suit le tick d'arrivée sans jamais se chevaucher
    const times: number[] = [];
    let cursor = -Infinity;
    for (const i of packets) {
      const arrival = d.ticks[i] / tr;
      const t = arrival > cursor + 0.25 || arrival < cursor - 0.5 ? arrival : cursor;
      times.push(t);
      cursor = t + FRAME_SEC;
    }
    const pcm: { t: number; data: Float32Array }[] = [];
    await new Promise<void>((resolve) => {
      let k = 0;
      const dec = new AudioDecoder({
        output: (a) => {
          const buf = new Float32Array(a.numberOfFrames);
          a.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
          pcm.push({ t: a.timestamp / 1e6, data: buf });
          a.close();
        },
        error: () => { /* paquet illisible : on passe */ },
      });
      dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      for (const i of packets) {
        const chunk = new EncodedAudioChunk({ type: 'key', timestamp: Math.round(times[k++] * 1e6), data: d.bytes.subarray(d.starts[i], d.starts[i] + d.lengths[i]) });
        try { dec.decode(chunk); } catch { /* ignoré */ }
      }
      dec.flush().then(() => { dec.close(); resolve(); }, () => resolve());
    });
    // Regroupement : frames consécutives (écart < 30 ms) = une prise de parole
    const segs: Segment[] = [];
    let group: { t: number; data: Float32Array }[] = [];
    const flush = () => {
      if (!group.length || !this.ctx) return;
      const len = group.reduce((a, g) => a + g.data.length, 0);
      const buffer = this.ctx.createBuffer(1, len, 48000);
      const ch = buffer.getChannelData(0);
      let o = 0;
      for (const g of group) { ch.set(g.data, o); o += g.data.length; }
      segs.push({ speaker, start: group[0].t, buffer });
      group = [];
    };
    pcm.sort((a, b) => a.t - b.t);
    for (const f of pcm) {
      const last = group[group.length - 1];
      if (last && f.t - (last.t + last.data.length / 48000) > 0.03) flush();
      group.push(f);
    }
    flush();
    return segs;
  }

  // --- Synchronisation avec le replay ---
  private stopAll() {
    for (const src of this.playing.values()) { try { src.stop(); } catch { /* déjà fini */ } }
    this.playing.clear();
    this.anchor = null;
  }

  private tick(force = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.pb.get();
    const game = s.tick / this.match.tickrate;
    const audible = s.playing && s.speed <= MAX_VOICE_SPEED;
    if (!audible) { if (this.playing.size || this.anchor) this.stopAll(); this.prefetch(s.tick); return; }
    // Saut, changement de vitesse ou reprise : on recale tout
    if (this.anchor) {
      const expected = this.anchor.game + (ctx.currentTime - this.anchor.ctx) * this.anchor.speed;
      if (Math.abs(expected - game) > 0.3 || this.anchor.speed !== s.speed) this.stopAll();
    }
    if (!this.anchor) { this.anchor = { ctx: ctx.currentTime + 0.05, game, speed: s.speed }; force = true; }
    const now = performance.now();
    if (!force && now - this.lastCheck < 200) return;
    this.lastCheck = now;
    this.schedule(s.tick);
  }

  private prefetch(tick: number) {
    const ri = this.roundAt(tick);
    void this.ensureRound(ri);
  }

  private schedule(tick: number) {
    const ctx = this.ctx!, a = this.anchor!;
    const ri = this.roundAt(tick);
    const segs = this.ensureRound(ri);
    if (segs instanceof Promise) {
      this.status = 'Decoding round…';
      this.emit();
      segs.then(() => { this.status = ''; this.emit(); this.tick(true); });
      return;
    }
    if (ri + 1 < this.match.rounds.length) void this.ensureRound(ri + 1);
    const game = a.game + (ctx.currentTime - a.ctx) * a.speed;
    for (const seg of segs) {
      if (this.playing.has(seg)) continue;
      const end = seg.start + seg.buffer.duration;
      if (end <= game || seg.start > game + LOOKAHEAD) continue;
      const src = ctx.createBufferSource();
      src.buffer = seg.buffer;
      src.playbackRate.value = a.speed;
      src.connect(this.gains[seg.speaker]);
      const when = a.ctx + (seg.start - a.game) / a.speed;
      if (when >= ctx.currentTime) src.start(when);
      else src.start(ctx.currentTime, Math.min(seg.buffer.duration, (ctx.currentTime - when) * a.speed));
      src.onended = () => this.playing.delete(seg);
      this.playing.set(seg, src);
    }
  }
}
