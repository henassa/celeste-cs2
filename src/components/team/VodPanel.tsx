// Panneau VOD du replay : la vidéo du stream (YouTube ou Twitch) calée sur la démo. On indique une fois
// à quel moment de la VOD correspond l'instant affiché ; ensuite la VOD suit (sauts, pause, lecture, vitesse).
// App de bureau : la VOD s'ouvre dans sa propre fenêtre (vrai site, lecture fiable) ; navigateur : lecteur intégré.

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, Tv, X } from 'lucide-react';
import type { MatchData } from '@/data/types';
import type { Playback } from '@/viewer/playback';
import { usePlayback } from '@/viewer/playback';
import { desktop } from '@/app/desktop';
import { formatClock, parseClock, parseVod, vodStore, type VodSource } from '@/app/vod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { tt } from '@/i18n';

export function VodPanel({ pb, match, demo, onClose }: { pb: Playback; match: MatchData; demo: string; onClose: () => void }) {
  const st = usePlayback(pb);
  const links = vodStore.use();
  const link = links[demo];
  const [url, setUrl] = useState(link?.url ?? '');
  const [clock, setClock] = useState('');
  const [follow, setFollow] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const src = link ? parseVod(link.url) : null;
  const frame = useRef<HTMLIFrameElement>(null);
  const demoSec = st.tick / match.tickrate;
  const vodSec = link ? demoSec + link.offset : null;

  const save = (patch: Partial<{ url: string; offset: number }>) => vodStore.set((all) => ({ ...all, [demo]: { url: link?.url ?? '', offset: link?.offset ?? 0, ...patch } }));
  const load = async () => {
    const s = parseVod(url);
    if (!s) { setErr('Paste a YouTube video link or a Twitch VOD link (twitch.tv/videos/…).'); return; }
    setErr(null);
    save({ url: url.trim() });
    if (desktop) await desktop.vodOpen(url.trim());
  };
  const syncHere = async (sec: number | null) => {
    if (sec == null) { setErr('Type the VOD time, like 1:02:33.'); return; }
    setErr(null);
    save({ offset: sec - demoSec });
  };

  // La VOD suit la démo : sauts et pause -> positionner ; lecture / pause ; vitesse
  const last = useRef({ tick: st.tick, playing: st.playing, speed: st.speed, at: 0 });
  useEffect(() => {
    if (!follow || !src || vodSec == null) return;
    const prev = last.current;
    const jumped = Math.abs(st.tick - prev.tick) / match.tickrate > (st.playing ? 2.5 : 0.05);
    const now = performance.now();
    if (jumped && now - prev.at > 250) { seek(src, vodSec); last.current.at = now; }
    if (st.playing !== prev.playing) { if (!st.playing) seek(src, vodSec); play(src, st.playing); }
    if (st.speed !== prev.speed) rate(src, st.speed);
    last.current = { ...last.current, tick: st.tick, playing: st.playing, speed: st.speed };
  }); // à chaque mise à jour de la lecture

  const post = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  const [twitchTime, setTwitchTime] = useState(0);
  function seek(s: VodSource, t: number) {
    if (desktop) { desktop.vodCmd({ type: 'seek', t }); return; }
    if (s.kind === 'youtube') post('seekTo', [t, true]); else setTwitchTime(Math.round(t));
  }
  function play(s: VodSource, on: boolean) {
    if (desktop) { desktop.vodCmd({ type: 'play', on }); return; }
    if (s.kind === 'youtube') post(on ? 'playVideo' : 'pauseVideo');
  }
  function rate(s: VodSource, r: number) {
    if (desktop) { desktop.vodCmd({ type: 'rate', rate: r }); return; }
    if (s.kind === 'youtube') post('setPlaybackRate', [r]);
  }

  const embed = !desktop && src ? (src.kind === 'youtube'
    ? `https://www.youtube.com/embed/${src.id}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${Math.round(vodSec ?? 0)}`
    : `https://player.twitch.tv/?video=v${src.id}&parent=${location.hostname}&autoplay=false&time=${formatClock(twitchTime).replace(/^(?:(\d+):)?(\d+):(\d+)$/, (_m, h, m, s) => `${h ?? 0}h${m}m${s}s`)}`) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="vod-panel">
      <div className="flex items-center gap-2 px-4 py-3">
        <Tv className="size-4" /><span className="text-sm font-medium">{tt('VOD')}</span>
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={tt('Close VOD')}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t px-4 py-4 text-sm">
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Stream or video of this match')}</div>
          <div className="flex gap-1.5">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tt('youtube.com/watch?v=… or twitch.tv/videos/…')} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') load(); }} />
            <Button size="sm" onClick={load}><Link2 /> {tt('Load')}</Button>
          </div>
        </div>
        {embed && <div className="aspect-video overflow-hidden rounded-lg border bg-black"><iframe ref={frame} src={embed} title="VOD" className="size-full" allow="autoplay; encrypted-media; fullscreen" /></div>}
        {desktop && src && <Button size="sm" variant="outline" onClick={() => desktop!.vodOpen(link!.url)}><ExternalLink /> {tt('Show the VOD window')}</Button>}
        {src && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium">{tt('Sync')}</div>
            <p className="text-xs text-muted-foreground">{tt('Find this exact moment in the VOD (round') + ' '}{match.rounds.findIndex((r) => st.tick <= r.officialEndTick) + 1}{tt(', demo time') + ' '}{formatClock(demoSec)}{tt(') and give its time:')}</p>
            <div className="flex gap-1.5">
              <Input className="w-28 font-mono" value={clock} onChange={(e) => setClock(e.target.value)} placeholder="1:02:33" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') syncHere(parseClock(clock)); }} />
              <Button size="sm" variant="outline" onClick={() => syncHere(parseClock(clock))}>{tt('Sync here')}</Button>
              {desktop && <Button size="sm" variant="outline" onClick={async () => { const t = await desktop!.vodCmd({ type: 'time' }); syncHere(typeof t === 'number' ? t : null); }} title={tt('Use the time the VOD window is at right now')}>{tt('Use VOD time')}</Button>}
            </div>
            {link && <p className="text-xs text-muted-foreground">{tt('VOD at') + ' '}<span className="num text-foreground">{formatClock(vodSec ?? 0)}</span> {tt('for this moment.')}</p>}
            <Toggle size="sm" variant="outline" pressed={follow} onPressedChange={setFollow}>{tt('VOD follows the replay')}</Toggle>
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        {!src && <p className="text-xs text-muted-foreground">{tt('Link the stream of this match to review the comms and the POV next to the radar.') + ' '}{desktop ? tt('The video opens in its own window.') : tt('YouTube follows every jump; Twitch reloads at the new time.')}</p>}
      </div>
    </div>
  );
}
