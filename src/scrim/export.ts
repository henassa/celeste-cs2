// Exports : image du radar et clip vidéo (avec HUD incrusté), enregistrés localement.

import type { Playback } from '../viewer/playback';
import { formatClock, roundClock, roundIndexAt } from '../viewer/sample';
import { nextFrame, safeName } from '../lib/download';

/** Nom de fichier lisible : carte, round et chrono. */
export function momentName(pb: Playback, ext: string): string {
  const m = pb.match;
  const tick = pb.get().tick;
  const r = m.rounds[roundIndexAt(m, tick)];
  const clock = r ? formatClock(roundClock(m, r, tick).remaining).replace(':', 'm') + 's' : '';
  return safeName(`${m.header.map}_r${r?.number ?? 0}_${clock}`) + '.' + ext;
}

/** Capture PNG du radar, HUD incrusté. */
export async function captureImage(pb: Playback, canvas: HTMLCanvasElement): Promise<Blob> {
  pb.set({ hud: true });
  await nextFrame();
  await nextFrame();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  pb.set({ hud: false });
  if (!blob) throw new Error('Could not capture the radar.');
  return blob;
}

export function clipMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export interface ClipOptions {
  /** Durée en secondes de jeu. */
  seconds: number;
  speed: number;
}

export interface ClipJob {
  done: Promise<Blob>;
  cancel: () => void;
}

/**
 * Enregistre le canvas pendant la lecture, à partir du tick courant.
 * La durée réelle d'enregistrement = secondes de jeu / vitesse.
 */
export function recordClip(pb: Playback, canvas: HTMLCanvasElement, opts: ClipOptions, onProgress: (k: number) => void): ClipJob {
  const mime = clipMimeType();
  if (!mime) throw new Error('Video recording is not supported in this browser.');
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const prev = pb.get();
  const startTick = prev.tick;
  const endTick = startTick + opts.seconds * pb.match.tickrate;
  let cancelled = false;
  let raf = 0;

  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      pb.set({ hud: false, playing: false, speed: prev.speed });
      if (cancelled) reject(new Error('cancelled'));
      else resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    };
    pb.set({ hud: true, playing: false, speed: opts.speed });
    // Laisse le HUD apparaître avant de démarrer
    requestAnimationFrame(() => requestAnimationFrame(() => {
      rec.start(250);
      pb.set({ playing: true });
      const tick = () => {
        const t = pb.get().tick;
        onProgress(Math.min(1, (t - startTick) / (endTick - startTick)));
        if (cancelled || t >= endTick || !pb.get().playing) { if (rec.state !== 'inactive') rec.stop(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }));
  });
  return {
    done,
    cancel: () => { cancelled = true; cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop(); },
  };
}
