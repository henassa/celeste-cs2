// Panneau Voix : extraction à la demande, liste des joueurs avec indicateur de parole,
// coupure, solo et volume. Rien n'est envoyé : tout est décodé dans le navigateur.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Headphones, Loader2, Volume2, VolumeX, X } from 'lucide-react';
import type { MatchData } from '@/data/types';
import type { Playback } from '@/viewer/playback';
import { usePlayback } from '@/viewer/playback';
import { loadVoice } from '@/data/load-demo';
import { MAX_VOICE_SPEED, VoiceEngine, voiceSupported } from '@/voice/engine';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; engine: VoiceEngine } | { kind: 'none' } | { kind: 'error'; message: string };

export function VoicePanel({ match, pb, file, onClose, onEngine }: { match: MatchData; pb: Playback; file: File | null; onClose: () => void; onEngine?: (e: VoiceEngine | null) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const engineRef = useRef<VoiceEngine | null>(null);
  useEffect(() => () => { engineRef.current?.dispose(); onEngine?.(null); }, [onEngine]);

  const load = async () => {
    if (!file) return;
    setState({ kind: 'loading' });
    try {
      const data = await loadVoice(file);
      if (!data.ticks.length) { setState({ kind: 'none' }); return; }
      const engine = new VoiceEngine(match, data, pb);
      engineRef.current = engine;
      (window as unknown as { __voice?: VoiceEngine }).__voice = engine;
      await engine.start();
      onEngine?.(engine);
      setState({ kind: 'ready', engine });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="absolute right-3 bottom-3 z-10 w-72 rounded-lg border bg-overlay p-3 text-xs text-overlay-foreground shadow-sm backdrop-blur-sm" data-testid="voice-panel">
      <div className="mb-2 flex items-center gap-2">
        <Headphones className="size-3.5" />
        <span className="font-medium">{tt('Voice comms')}</span>
        <span className="flex-1" />
        <button className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label={tt('Close voice')}><X className="size-3.5" /></button>
      </div>
      {!voiceSupported() ? (
        <p className="text-muted-foreground">{tt('Voice playback needs a browser with WebCodecs (Chrome, Edge or a recent Firefox).')}</p>
      ) : !file ? (
        <p className="text-muted-foreground">{tt('Open the demo file again to load its voice.')}</p>
      ) : state.kind === 'idle' ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">{tt('FACEIT demos usually record team voice. Valve matchmaking demos don\'t. Decoding stays on your computer.')}</p>
          <Button size="xs" onClick={load}>{tt('Load voice')}</Button>
        </div>
      ) : state.kind === 'loading' ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {tt('Reading voice from the demo…')}</p>
      ) : state.kind === 'none' ? (
        <p className="text-muted-foreground">{tt('No voice recorded in this demo.')}</p>
      ) : state.kind === 'error' ? (
        <p className="text-destructive">{state.message}</p>
      ) : (
        <Mixer engine={state.engine} match={match} pb={pb} />
      )}
    </div>
  );
}

function Mixer({ engine, match, pb }: { engine: VoiceEngine; match: MatchData; pb: Playback }) {
  useSyncExternalStore(engine.subscribe, () => engine.speakers.map((s) => `${s.muted}${s.volume}`).join() + engine.soloed + engine.status + engine.masterVolume);
  const st = usePlayback(pb);
  const speaking = engine.speakingAt(st.tick);
  const team = (p: number) => (p >= 0 ? match.players[p].team : -1);
  return (
    <div className="space-y-2">
      {st.playing && st.speed > MAX_VOICE_SPEED && <p className="text-muted-foreground">{tt('Voice is muted above') + ' '}{MAX_VOICE_SPEED}×.</p>}
      {!st.playing && <p className="text-muted-foreground">{tt('Press play to hear the round.')}</p>}
      {engine.status && <p className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {engine.status}</p>}
      {([0, 1] as const).map((t) => {
        const list = engine.speakers.map((s, i) => ({ s, i })).filter(({ s }) => team(s.player) === t);
        if (!list.length) return null;
        return (
          <div key={t} className="space-y-0.5">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{match.teams[t].name}</div>
            {list.map(({ s, i }) => {
              const off = s.muted || (engine.soloed !== null && engine.soloed !== i);
              return (
                <div key={s.steamid} className="flex items-center gap-1.5">
                  <span className={cn('size-1.5 shrink-0 rounded-full', speaking.has(i) && !off ? 'bg-foreground' : 'bg-muted')} />
                  <span className={cn('min-w-0 flex-1 truncate', off && 'text-muted-foreground line-through')}>{s.name}</span>
                  <input type="range" min={0} max={1.5} step={0.05} value={s.volume} onChange={(e) => engine.setVolume(i, Number(e.target.value))}
                    className="h-1 w-14 accent-foreground" aria-label={`${s.name} volume`} />
                  <button onClick={() => engine.setSolo(i)} aria-label={tt('Solo {0}', [s.name])} title={tt('Solo')}
                    className={cn('rounded-sm border px-1 text-[10px]', engine.soloed === i ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>S</button>
                  <button onClick={() => engine.setMuted(i, !s.muted)} aria-label={`${s.muted ? tt('Unmute') : tt('Mute')} ${s.name}`} className="text-muted-foreground hover:text-foreground">
                    {s.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      <div className="flex items-center gap-2 border-t pt-2">
        <span className="text-muted-foreground">{tt('Master')}</span>
        <input type="range" min={0} max={1.5} step={0.05} value={engine.masterVolume} onChange={(e) => engine.setMaster(Number(e.target.value))} className="h-1 flex-1 accent-foreground" aria-label={tt('Master volume')} />
      </div>
    </div>
  );
}
