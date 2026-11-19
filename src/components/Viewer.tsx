// Vue principale du lecteur : en-tête (score, chrono), panneaux d'équipe, radar, timeline.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FolderOpen, Headphones, Sparkles, Layers, NotebookPen, Presentation, Route, Share, Tv, Type } from 'lucide-react';
import { VoicePanel } from './VoicePanel';
import type { VoiceEngine } from '@/voice/engine';
import { MomentsPanel } from './MomentsPanel';
import { CoachPanel } from './CoachPanel';
import { boardFromMoment } from '@/board/from-replay';
import type { Board } from '@/board/types';
import { SAMPLE_STEP, SIDE_CT, type MatchData } from '@/data/types';
import { placeAt, placeLabel, playerSetpos } from '@/viewer/places';
import { CopySetpos } from './CopySetpos';
import { getMap, mapDisplayName } from '@/maps/maps';
import { Playback, SPEEDS, usePlayback } from '@/viewer/playback';
import { syncTeamColors, useTeamColors } from '@/app/team-colors';
import { RadarCanvas } from '@/viewer/RadarCanvas';
import { formatClock, roundClock, roundIndexAt } from '@/viewer/sample';
import { TeamPanel } from './TeamPanel';
import { KillFeed } from './KillFeed';
import { Timeline } from './Timeline';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Toggle } from '@/components/ui/toggle';
import { ScrimStore, useScrim } from '@/scrim/store';
import { demoId } from '@/scrim/storage';
import { DrawToolbar, TextInputOverlay } from './DrawToolbar';
import { NotesPanel } from './NotesPanel';
import { ExportDialog } from './ExportDialog';
import { QueueBar } from './QueueBar';
import { ZonesChip } from './ZonesChip';
import { roundsQueue, watchQueue, type QueueState } from '@/viewer/queue';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ReplayView } from '@/app/router';
import { hasNav } from '@/three/nav-maps';

const Replay3D = lazy(() => import('./three/Replay3D'));
const GrenadesView = lazy(() => import('./GrenadesView').then((m) => ({ default: m.GrenadesView })));
const OverlayView = lazy(() => import('./OverlayView').then((m) => ({ default: m.OverlayView })));
const StatsView = lazy(() => import('./StatsView').then((m) => ({ default: m.StatsView })));
import { clampW, setLayout, setPresentation, toggleDock, toggleFocus, togglePresentation, useLayout, usePresentation, type DockPanel } from '@/app/layout';
import { LowerThird, PresentationHint, Scorebar } from './Presentation';
import { ResizeHandle } from './shell/ResizeHandle';
import { LayoutMenu } from './shell/LayoutMenu';
import { useReplayCommands } from './replay-commands';
import { AddToPlaybookDialog } from './team/AddToPlaybook';
import { VodPanel } from './team/VodPanel';
import { getMyTeam } from '@/app/my-team';
import { useNarrow, useShort } from '@/app/use-narrow';
import { tt } from '@/i18n';

/** Score compact quand les panneaux d'équipe sont masqués. */
function MiniScore({ match, score, sideOf }: { match: MatchData; score: [number, number]; sideOf: (t: 0 | 1) => number }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-md border bg-overlay px-2.5 py-1 text-xs text-overlay-foreground shadow-sm backdrop-blur-sm">
      <span className={sideOf(0) === SIDE_CT ? 'text-side-ct' : 'text-side-t'}>{match.teams[0].name}</span>
      <span className="num font-semibold">{score[0]}–{score[1]}</span>
      <span className={sideOf(1) === SIDE_CT ? 'text-side-ct' : 'text-side-t'}>{match.teams[1].name}</span>
    </div>
  );
}

interface Props {
  match: MatchData;
  /** Round à afficher à l'ouverture (index), sinon le premier. */
  startRound?: number | null;
  /** Rounds à enchaîner à l'ouverture (rounds filtrés dans l'analyse), dans l'ordre. */
  queueRounds?: number[] | null;
  onClose: () => void;
  /** Ouvre un tableau tactique créé à partir de l'instant affiché. */
  onBoard?: (b: Board) => void;
  /** Fichier de la démo (pour extraire la voix à la demande). */
  file?: File | null;
  /** Le replay est la page affichée (sinon : en pause, raccourcis inactifs). */
  active?: boolean;
  view?: ReplayView;
  onView?: (v: ReplayView) => void;
}

export function Viewer({ match, startRound, queueRounds, onClose, onBoard, file, active = true, view: viewProp, onView }: Props) {
  const pb = useMemo(() => {
    const p = new Playback(match);
    if (startRound != null) p.goToRound(startRound);
    return p;
  }, [match, startRound]);
  // Accès console pour le debug et les tests e2e (local uniquement, rien n'est envoyé)
  useEffect(() => { (window as unknown as { __pb?: Playback }).__pb = pb; }, [pb]);
  const state = usePlayback(pb);
  const map = getMap(match.header.map);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layerShown, setLayerShown] = useState<'upper' | 'lower'>('upper');
  const onLayerChange = useCallback((l: 'upper' | 'lower') => setLayerShown(l), []);
  const scrim = useMemo(() => new ScrimStore({
    id: demoId(match), fileName: match.source.fileName, map: match.header.map, rounds: match.rounds.length,
  }), [match]);
  useEffect(() => { scrim.init(); (window as unknown as { __scrim?: ScrimStore }).__scrim = scrim; }, [scrim]);
  const scrimVersion = useScrim(scrim);

  const layout = useLayout();
  const narrow = useNarrow();
  const short = useShort();
  const pres = usePresentation();
  const presRef = useRef(false);
  presRef.current = pres.on && active;
  const getPresTeams = () => presTeamsRef.current;
  const presTeamsRef = useRef(true);
  presTeamsRef.current = pres.teams;
  const side = layout.dock;
  const setSide = (d: DockPanel | null) => setLayout({ dock: d });
  const [exportOpen, setExportOpen] = useState(false);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [localView, setLocalView] = useState<ReplayView>('replay');
  const view = viewProp ?? localView;
  const setView = useCallback((v: ReplayView) => { if (onView) onView(v); else setLocalView(v); }, [onView]);
  // Page quittée : on met en pause
  useEffect(() => { if (!active) pb.set({ playing: false }); }, [active, pb]);
  // File de lecture (playlist ou rounds filtrés)
  const [queue, setQueue] = useState<QueueState | null>(() => {
    if (!queueRounds || queueRounds.length < 2) return null;
    const items = roundsQueue(match, queueRounds);
    return { title: tt('Filtered rounds'), items, index: Math.max(0, queueRounds.indexOf(startRound ?? -1)) };
  });
  useEffect(() => {
    if (!queue) return;
    return watchQueue(pb, queue, (i) => setQueue((q) => (q ? { ...q, index: i } : q)), () => setQueue(null));
  }, [pb, queue]);
  const playQueue = useCallback((q: QueueState) => {
    const it = q.items[q.index];
    if (!it) return;
    setView('replay');
    pb.set({ tick: it.fromTick, playing: true });
    setQueue(q);
  }, [pb, setView]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Voix chargée : qui parle (radar et panneaux d'équipe)
  const [voice, setVoice] = useState<VoiceEngine | null>(null);
  const speakingRef = useRef<((tick: number) => Set<number>) | null>(null);
  speakingRef.current = voice ? (t: number) => voice.speakingPlayersAt(t) : null;
  const onVoiceEngine = useCallback((e: VoiceEngine | null) => setVoice(e), []);

  // Raccourcis clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (document.querySelector('[role=dialog]')) return;
      const s = pb.get();
      // Annuler / rétablir (dessins, marqueurs)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) scrim.redo(); else scrim.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); scrim.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tr = match.tickrate;
      const ri = roundIndexAt(match, s.tick);
      const speedIdx = SPEEDS.indexOf(s.speed as (typeof SPEEDS)[number]);
      switch (e.key) {
        case ' ': e.preventDefault(); pb.set({ playing: !s.playing }); break;
        case 'ArrowLeft': pb.set({ tick: s.tick - (e.shiftKey ? 1 : 5) * tr }); break;
        case 'ArrowRight': pb.set({ tick: s.tick + (e.shiftKey ? 1 : 5) * tr }); break;
        case 'q': case 'Q': pb.goToRound(ri - 1); break;
        case 'e': case 'E': pb.goToRound(ri + 1); break;
        case 'ArrowUp': pb.set({ speed: SPEEDS[Math.min(SPEEDS.length - 1, speedIdx + 1)] }); break;
        case 'ArrowDown': pb.set({ speed: SPEEDS[Math.max(0, speedIdx - 1)] }); break;
        case 'Escape': if (scrim.cancelStroke()) break; if (presRef.current && scrim.tool === 'select' && s.follow < 0) { setPresentation({ on: false }); break; } if (scrim.tool !== 'select') scrim.setTool('select'); else pb.set({ follow: -1 }); break;
        case 'v': case 'V': scrim.setTool('select'); break;
        case 'b': case 'B': scrim.setTool('pen'); break;
        case 'a': case 'A': scrim.setTool('arrow'); break;
        case 'x': case 'X': scrim.setTool('eraser'); break;
        case 's': case 'S': scrim.setTool('line'); break;
        case 'o': case 'O': scrim.setTool('circle'); break;
        case 'r': case 'R': scrim.setTool('rect'); break;
        case 'i': case 'I': scrim.setTool('text'); break;
        case 'm': case 'M': scrim.addMarker(s.tick, ri); break;
        case 'n': case 'N': pb.set({ showNames: !s.showNames }); break;
        case 't': case 'T': pb.set({ showTrails: !s.showTrails }); break;
        case 'l': case 'L': if (map?.hasLower) pb.set({ layer: s.layer === 'upper' ? 'lower' : 'upper', follow: -1 }); break;
        case 'f': case 'F': toggleFocus(); break;
        case 'p': case 'P': togglePresentation(); break;
        case 'h': case 'H': if (presRef.current) setPresentation({ teams: !getPresTeams() }); break;
        case 'g': case 'G': toggleDock('moments'); break;
        default: {
          // 1-5 / 6-0 : suivre un joueur (équipe gauche puis droite)
          const n = '1234567890'.indexOf(e.key);
          if (n >= 0) {
            const team = n < 5 ? 0 : 1;
            const slot = (n % 5) + 1;
            const p = match.players.findIndex((pl) => pl.team === team && pl.slot === slot);
            if (p >= 0) pb.set({ follow: s.follow === p ? -1 : p });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pb, match, map, scrim, active]);

  const ri = roundIndexAt(match, state.tick);
  // Couleurs des joueurs (réglage par camp ou par équipe) suivant le round affiché
  const teamColors = useTeamColors();
  useEffect(() => { syncTeamColors(match, ri); }, [match, ri, teamColors]);
  useEffect(() => () => syncTeamColors(), [match]);
  const round = match.rounds[ri];
  const clock = round ? roundClock(match, round, state.tick) : null;
  const before: [number, number] = ri > 0 ? match.rounds[ri - 1].scoreAfter : [0, 0];
  const final = match.rounds[match.rounds.length - 1]?.scoreAfter ?? [0, 0];
  const live = view === 'replay' || view === '3d';
  const score = !live ? final : round && state.tick >= round.endTick ? round.scoreAfter : before;
  const sideOf = (team: 0 | 1) => (round && round.ctTeam === team ? SIDE_CT : 2);

  const speakingNow = voice ? voice.speakingPlayersAt(state.tick) : undefined;
  const followPlace = state.follow >= 0 ? placeAt(match, Math.round(state.tick / SAMPLE_STEP), state.follow) : '';

  const boardNow = useMemo(() => (onBoard ? () => { pb.set({ playing: false }); onBoard(boardFromMoment(match, pb.get().tick, layerShown)); } : undefined), [onBoard, pb, match, layerShown]);
  const openPlaybook = useCallback(() => { pb.set({ playing: false }); setPlaybookOpen(true); }, [pb]);
  useReplayCommands({ active, pb, match, view, setView, ri, setExportOpen, setVoiceOpen, onBoard: boardNow, onPlaybook: openPlaybook });

  const toggles = (
    <div className="flex items-center gap-1">
      {map?.hasLower && (
        <Tooltip><TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={() => pb.set({ layer: layerShown === 'upper' ? 'lower' : 'upper', follow: -1 })}>
            <Layers /> {layerShown === 'upper' ? tt('Upper') : tt('Lower')}
          </Button>
        </TooltipTrigger><TooltipContent>{tt('Switch level (L)')}</TooltipContent></Tooltip>
      )}
      <Tooltip><TooltipTrigger asChild>
        <Toggle size="sm" pressed={state.showNames} onPressedChange={(v) => pb.set({ showNames: v })} aria-label={tt('Player names')}><Type /></Toggle>
      </TooltipTrigger><TooltipContent>{tt('Player names (N)')}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild>
        <Toggle size="sm" pressed={voiceOpen} onPressedChange={setVoiceOpen} aria-label={tt('Voice comms')}><Headphones /></Toggle>
      </TooltipTrigger><TooltipContent>{tt('Voice comms')}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild>
        <Toggle size="sm" pressed={state.showTrails} onPressedChange={(v) => pb.set({ showTrails: v })} aria-label={tt('Grenade trails')}><Route /></Toggle>
      </TooltipTrigger><TooltipContent>{tt('Grenade trails (T)')}</TooltipContent></Tooltip>
      {onBoard && (
        <Tooltip><TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={() => { pb.set({ playing: false }); onBoard(boardFromMoment(match, pb.get().tick, layerShown)); }}>
            <Presentation /> {tt('Board')}
          </Button>
        </TooltipTrigger><TooltipContent>{tt('Open this moment on a tactical board')}</TooltipContent></Tooltip>
      )}
      <Button size="sm" variant="outline" onClick={() => { pb.set({ playing: false }); setExportOpen(true); }}>
        <Share /> {tt('Export')}
      </Button>
    </div>
  );

  if (pres.on && active && (view === 'replay' || view === '3d')) {
    const progress = round ? Math.max(0, Math.min(1, (state.tick - round.startTick) / Math.max(1, round.officialEndTick - round.startTick))) : 0;
    return (
      <div className={cn('relative flex h-full flex-col gap-3 p-3', pres.background === 'green' && 'bg-[#00b140]')} data-testid="presentation">
        <Scorebar match={match} score={score} round={round} clock={clock} live />
        <div className="flex min-h-0 flex-1 gap-3">
          {pres.teams && <div className="min-h-0 w-[250px] shrink-0"><TeamPanel pb={pb} team={0} tick={state.tick} follow={state.follow} align="left" speaking={speakingNow} /></div>}
          {view === '3d' && hasNav(match.header.map)
            ? <Suspense fallback={<div className="flex-1" />}><main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card"><Replay3D pb={pb} follow={state.follow} scrim={scrim} /></main></Suspense>
            : (
              <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
                <RadarCanvas pb={pb} scrim={scrim} onLayerChange={onLayerChange} canvasRef={canvasRef} speaking={speakingRef} />
                <KillFeed pb={pb} match={match} tick={state.tick} />
                <TextInputOverlay scrim={scrim} />
                {state.follow >= 0 && (
                  <div className="absolute top-3 left-3 rounded-md border bg-overlay px-2.5 py-1 text-sm text-overlay-foreground backdrop-blur-sm">
                    <span className="font-medium">{match.players[state.follow].name}</span>{followPlace && <span className="ml-2 text-muted-foreground">{placeLabel(followPlace)}</span>}
                  </div>
                )}
              </main>
            )}
          {pres.teams && <div className="min-h-0 w-[250px] shrink-0"><TeamPanel pb={pb} team={1} tick={state.tick} follow={state.follow} align="right" speaking={speakingNow} /></div>}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground transition-[width] duration-100" style={{ width: `${progress * 100}%` }} /></div>
        <LowerThird note={round ? scrim.doc.roundNotes[round.number] ?? '' : ''} />
        <PresentationHint />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* En-tête */}
      <header className={cn('grid shrink-0 items-center px-2', short ? 'h-8' : 'h-12', narrow ? 'grid-cols-1 justify-items-center' : 'grid-cols-[1fr_auto_1fr]')}>
        <div className={cn('flex min-w-0 items-center gap-2', narrow && 'hidden')}>
          <Tooltip><TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={tt('Open another demo')}><FolderOpen /></Button>
          </TooltipTrigger><TooltipContent>{tt('Open another demo')}</TooltipContent></Tooltip>
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-medium">{mapDisplayName(match.header.map)}</div>
            <div className="truncate text-xs text-muted-foreground">{match.source.fileName}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className={cn('truncate text-right text-sm font-medium', narrow ? 'max-w-24 text-xs' : 'max-w-48', sideOf(0) === SIDE_CT ? 'text-side-ct' : 'text-side-t')}>{match.teams[0].name}</span>
          <span className="num text-2xl font-semibold">{score[0]}</span>
          <div className="flex w-24 flex-col items-center gap-0.5">
            <span className={cn('num rounded-md bg-muted px-2 py-0.5 text-sm font-medium', clock?.phase === 'planted' && 'text-destructive')}>
              {!live ? tt('Final') : clock ? formatClock(clock.remaining) : '--'}
            </span>
            <span className={cn('text-[11px] text-muted-foreground', !live && 'invisible')}>
              {round ? tt('Round {0}', [round.number]) : ''}{clock?.phase === 'freeze' ? ' · Freeze' : clock?.phase === 'over' ? ' · End' : ''}
            </span>
          </div>
          <span className="num text-2xl font-semibold">{score[1]}</span>
          <span className={cn('truncate text-sm font-medium', narrow ? 'max-w-24 text-xs' : 'max-w-48', sideOf(1) === SIDE_CT ? 'text-side-ct' : 'text-side-t')}>{match.teams[1].name}</span>
        </div>
        <div className={cn('flex items-center justify-end gap-2', narrow && 'hidden')}>
          {!onView && <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => { if (v) { setView(v as typeof view); pb.set({ playing: false }); } }} aria-label={tt('View')}>
            <ToggleGroupItem value="replay" className="px-3 text-xs">{tt('Replay')}</ToggleGroupItem>
            <ToggleGroupItem value="overlay" className="px-3 text-xs">{tt('Overlay')}</ToggleGroupItem>
            <ToggleGroupItem value="grenades" className="px-3 text-xs">{tt('Grenades')}</ToggleGroupItem>
            <ToggleGroupItem value="stats" className="px-3 text-xs">{tt('Stats')}</ToggleGroupItem>
          </ToggleGroup>}
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            {([['coach', Bot, tt('Coach (C)')], ['moments', Sparkles, tt('Moments (G)')], ['notes', NotebookPen, tt('Notes')], ['vod', Tv, tt('VOD (stream sync)')]] as const).map(([k, I, label]) => (
              <Tooltip key={k}><TooltipTrigger asChild>
                <Toggle size="sm" className="h-7" pressed={side === k} onPressedChange={(v) => setSide(v ? k : null)} aria-label={`${label.split(' (')[0]} panel`} disabled={view !== 'replay'}><I /></Toggle>
              </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
            ))}
          </div>
          <LayoutMenu />
        </div>
      </header>

      <Suspense fallback={view === 'grenades' || view === 'overlay' || view === 'stats' ? <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{tt('Loading…')}</div> : null}>
      {view === 'grenades' && <GrenadesView match={match} onWatch={(g) => {
        setView('replay');
        pb.set({ follow: g.thrower });
        pb.jumpBefore(g.throw?.tick ?? g.throwTick, 2);
      }} />}
      {view === 'overlay' && <OverlayView match={match} onOpen={(r, sec) => {
        const rd = match.rounds[r];
        setView('replay');
        pb.set({ tick: Math.min(rd.officialEndTick, rd.freezeEndTick + sec * match.tickrate), playing: false });
      }} />}
      {view === 'stats' && <StatsView match={match} file={file ?? null} onPlayer={(p) => { setView('replay'); pb.set({ follow: p }); }} onRound={(r) => { setView('replay'); pb.goToRound(r); }} />}
      </Suspense>
      {/* Corps */}
      {(view === 'replay' || view === '3d') && (() => {
        const dockEl = side === 'coach' ? <CoachPanel pb={pb} scrim={scrim} roundIndex={ri} onClose={() => setSide(null)} />
          : side === 'moments' ? <MomentsPanel pb={pb} roundIndex={ri} onClose={() => setSide(null)} />
          : side === 'vod' ? <VodPanel pb={pb} match={match} demo={demoId(match)} onClose={() => setSide(null)} />
          : side === 'notes' ? <NotesPanel pb={pb} scrim={scrim} roundIndex={ri} onClose={() => setSide(null)} onPlayPlaylist={(from) => playQueue({ title: tt('Playlist'), items: scrim.playlist, index: from })} />
          : null;
        const dock = dockEl && !narrow && (
          <>
            {layout.dockSide === 'right' && <ResizeHandle label={tt('Resize side panel')} invert onResize={(dx) => setLayout((l) => ({ dockW: clampW(l.dockW + dx, 260, 640) }))} onReset={() => setLayout({ dockW: 320 })} />}
            <div className="min-h-0 shrink-0" style={{ width: layout.dockW }} data-testid="replay-dock">{dockEl}</div>
            {layout.dockSide === 'left' && <ResizeHandle label={tt('Resize side panel')} onResize={(dx) => setLayout((l) => ({ dockW: clampW(l.dockW + dx, 260, 640) }))} onReset={() => setLayout({ dockW: 320 })} />}
          </>
        );
        return (
          <div className="flex min-h-0 flex-1 gap-2" data-testid="replay-body">
            {layout.dockSide === 'left' && dock}
            {layout.left && !narrow && (
              <>
                <div className="min-h-0 shrink-0" style={{ width: layout.leftW }}><TeamPanel pb={pb} team={0} tick={state.tick} follow={state.follow} align="left" speaking={speakingNow} /></div>
                <ResizeHandle label={tt('Resize left team panel')} onResize={(dx) => setLayout((l) => ({ leftW: clampW(l.leftW + dx) }))} onReset={() => setLayout({ leftW: 270 })} />
              </>
            )}
            <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
              {view === '3d'
                ? (hasNav(match.header.map)
                  ? <Suspense fallback={<div className="absolute inset-0" />}><Replay3D pb={pb} follow={state.follow} scrim={scrim} /></Suspense>
                  : <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">{tt('No 3D model for') + ' '}{mapDisplayName(match.header.map)} {tt('yet: available for Ancient, Anubis, Cache, Dust2, Inferno, Mirage, Nuke, Overpass, Train and Vertigo.')}</div>)
                : <RadarCanvas pb={pb} scrim={scrim} onLayerChange={onLayerChange} canvasRef={canvasRef} speaking={speakingRef} />}
              <ZonesChip map={match.header.map} className="absolute right-3 bottom-3 z-10" />
              {layout.killfeed && <KillFeed pb={pb} match={match} tick={state.tick} />}
              <DrawToolbar scrim={scrim} round={ri} />
              {voiceOpen && <VoicePanel match={match} pb={pb} file={file ?? null} onClose={() => setVoiceOpen(false)} onEngine={onVoiceEngine} />}
              {queue && <QueueBar queue={queue} onGo={(i) => playQueue({ ...queue, index: i })} onClose={() => setQueue(null)} />}
              <TextInputOverlay scrim={scrim} />
              {state.follow >= 0 && (
                <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md border bg-overlay px-2.5 py-1 text-xs text-overlay-foreground shadow-sm backdrop-blur-sm">
                  {tt('Following') + ' '}<span className="font-medium">{match.players[state.follow].name}</span>
                  {followPlace && <span className="text-muted-foreground">{placeLabel(followPlace)}</span>}
                  <CopySetpos get={() => playerSetpos(match, pb.get().tick, state.follow)} />
                  <kbd className="rounded-sm border px-1 font-mono text-[10px] text-muted-foreground">{tt('Esc')}</kbd>
                </div>
              )}
              {!layout.left && !layout.right && !narrow && (
                <MiniScore match={match} score={score} sideOf={sideOf} />
              )}
            </main>
            {layout.right && !narrow && (
              <>
                <ResizeHandle label={tt('Resize right team panel')} invert onResize={(dx) => setLayout((l) => ({ rightW: clampW(l.rightW + dx) }))} onReset={() => setLayout({ rightW: 270 })} />
                <div className="min-h-0 shrink-0" style={{ width: layout.rightW }}><TeamPanel pb={pb} team={1} tick={state.tick} follow={state.follow} align="right" speaking={speakingNow} /></div>
              </>
            )}
            {layout.dockSide === 'right' && dock}
          </div>
        );
      })()}

      {(view === 'replay' || view === '3d') && layout.timeline && <Timeline pb={pb} state={state} scrim={scrim} scrimVersion={scrimVersion} right={toggles} winCurve={layout.winCurve} />}
      <ExportDialog pb={pb} canvas={() => canvasRef.current} open={exportOpen} onOpenChange={setExportOpen} />
      {playbookOpen && <AddToPlaybookDialog open={playbookOpen} onOpenChange={setPlaybookOpen}
        moment={{ demoId: demoId(match), fileName: match.source.fileName, map: match.header.map, round: ri, tick: Math.round(state.tick), side: (() => { const ids = new Set(getMyTeam().players.map((p) => p.steamid)); const n = [0, 0]; for (const p of match.players) if (ids.has(p.steamid) && (p.team === 0 || p.team === 1)) n[p.team]++; const ours = n[1] > n[0] ? 1 : 0; return (match.rounds[ri]?.ctTeam ?? 0) === ours ? 'ct' : 't'; })() }} />}
    </div>
  );
}
