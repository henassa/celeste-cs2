// Commandes du replay dans la palette (Ctrl+K) : rounds, joueurs, vues, panneaux, dispositions.

import { useMemo } from 'react';
import type { MatchData } from '@/data/types';
import type { Playback } from '@/viewer/playback';
import type { ReplayView } from '@/app/router';
import { useCommands, type Command } from '@/app/commands';
import { applyPreset, getPresentationBg, LAYOUT_PRESETS, loadCustomLayouts, setLayout, setPresentation, toggleDock, toggleFocus, togglePresentation } from '@/app/layout';
import { tt } from '@/i18n';

interface Args {
  active: boolean;
  pb: Playback;
  match: MatchData;
  view: ReplayView;
  setView: (v: ReplayView) => void;
  ri: number;
  setExportOpen: (o: boolean) => void;
  setVoiceOpen: (f: (o: boolean) => boolean) => void;
  onBoard?: () => void;
  onPlaybook?: () => void;
}

const NONE: Command[] = [];

export function useReplayCommands({ active, pb, match, setView, setExportOpen, setVoiceOpen, onBoard, onPlaybook }: Args): void {
  const cmds = useMemo<Command[]>(() => {
    if (!active) return NONE;
    const replay = (f: () => void) => () => { setView('replay'); f(); };
    const goto: Command & { runWith: (n: number) => void } = {
      id: 'replay.goto-round', title: tt('Go to round…'), group: tt('Replay'), keywords: 'round jump', run: () => {},
      runWith: (n) => { if (n >= 0 && n < match.rounds.length) replay(() => pb.goToRound(n))(); },
    };
    const rounds = match.rounds.map((r, i): Command => ({
      id: `replay.round.${i}`, title: tt('Round {0}', [r.number]), group: tt('Rounds'),
      keywords: `r${r.number} ${r.winnerTeam != null ? match.teams[r.winnerTeam].name : ''} ${r.reason} ${r.plant ? `plant ${r.plant.site}` : ''}`,
      run: replay(() => pb.goToRound(i)),
    }));
    const players = match.players.filter((p) => p.team === 0 || p.team === 1).map((p): Command => ({
      id: `replay.follow.${p.steamid}`, title: tt('Follow {0}', [p.name]), group: tt('Players'), keywords: match.teams[p.team].name,
      run: replay(() => pb.set({ follow: match.players.indexOf(p) })),
    }));
    return [
      goto,
      { id: 'replay.play', title: tt('Play / pause'), group: tt('Replay'), shortcut: 'Space', run: replay(() => pb.set({ playing: !pb.get().playing })) },
      { id: 'replay.view.3d', title: tt('Replay in 3D'), group: tt('Replay'), keywords: 'three model', run: () => setView('3d') },
      { id: 'replay.view.overlay', title: tt('Overlay all rounds'), group: tt('Replay'), run: () => setView('overlay') },
      { id: 'replay.view.grenades', title: tt('Grenades of the match'), group: tt('Replay'), run: () => setView('grenades') },
      { id: 'replay.view.stats', title: tt('Match stats'), group: tt('Replay'), keywords: 'scoreboard aim duels', run: () => setView('stats') },
      { id: 'replay.names', title: tt('Toggle player names'), group: tt('Replay'), shortcut: 'N', run: () => pb.set({ showNames: !pb.get().showNames }) },
      { id: 'replay.trails', title: tt('Toggle grenade trails'), group: tt('Replay'), shortcut: 'T', run: () => pb.set({ showTrails: !pb.get().showTrails }) },
      { id: 'replay.voice', title: tt('Voice comms'), group: tt('Replay'), keywords: 'audio', run: replay(() => setVoiceOpen((o) => !o)) },
      { id: 'replay.export', title: tt('Export clip or image'), group: tt('Replay'), keywords: 'video gif png', run: replay(() => { pb.set({ playing: false }); setExportOpen(true); }) },
      ...(onBoard ? [{ id: 'replay.board', title: tt('Open this moment on a board'), group: tt('Replay'), run: onBoard }] : []),
      ...(onPlaybook ? [{ id: 'replay.playbook', title: tt('Add this moment to the playbook'), group: tt('Replay'), keywords: 'strat strategy save round', run: onPlaybook }] : []),
      { id: 'panel.coach', title: tt('Coach panel'), group: tt('Panels'), shortcut: 'C', run: replay(() => toggleDock('coach')) },
      { id: 'panel.moments', title: tt('Moments panel'), group: tt('Panels'), shortcut: 'G', run: replay(() => toggleDock('moments')) },
      { id: 'panel.notes', title: tt('Notes panel'), group: tt('Panels'), run: replay(() => toggleDock('notes')) },
      { id: 'panel.present', title: tt('Presentation mode (stream)'), group: tt('Panels'), shortcut: 'P', keywords: 'broadcast cast obs fullscreen', run: replay(togglePresentation) },
      { id: 'panel.present-green', title: tt('Presentation on green background (chroma key)'), group: tt('Panels'), keywords: 'obs chroma', run: replay(() => setPresentation({ on: true, background: getPresentationBg() === 'green' ? 'dark' : 'green' })) },
      { id: 'panel.focus', title: tt('Focus mode (radar only)'), group: tt('Panels'), shortcut: 'F', run: replay(toggleFocus) },
      { id: 'panel.left', title: tt('Toggle left team panel'), group: tt('Panels'), run: () => setLayout((l) => ({ left: !l.left })) },
      { id: 'panel.right', title: tt('Toggle right team panel'), group: tt('Panels'), run: () => setLayout((l) => ({ right: !l.right })) },
      ...LAYOUT_PRESETS.map((p) => ({ id: `layout.${p.id}`, title: tt('Layout: {0}', [p.label]), group: tt('Layouts'), keywords: p.hint, run: replay(() => applyPreset(p.layout)) })),
      ...loadCustomLayouts().map((c) => ({ id: `layout.custom.${c.name}`, title: tt('Layout: {0}', [c.name]), group: tt('Layouts'), run: replay(() => applyPreset(c.layout)) })),
      ...rounds,
      ...players,
    ];
  }, [active, pb, match, setView, setExportOpen, setVoiceOpen, onBoard, onPlaybook]);
  useCommands('replay', cmds);
}
