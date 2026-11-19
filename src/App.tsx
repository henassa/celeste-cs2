// Coquille de l'application : barre latérale, pages pilotées par l'adresse (#/...), palette de
// commandes, coach global. Le replay ouvert reste en mémoire quand on navigue ailleurs.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchData } from '@/data/types';
import { loadDemo } from '@/data/load-demo';
import { DropZone } from '@/components/DropZone';
import { Dashboard } from '@/components/home/Dashboard';
import { SetupWizard } from '@/components/settings/SetupWizard';
import { TitleBar } from '@/components/shell/TitleBar';
import { isDesktop } from '@/app/desktop';
import { useNarrow } from '@/app/use-narrow';
import { Button } from '@/components/ui/button';
import { Menu, Search } from 'lucide-react';
// Pages chargées à la demande (démarrage plus rapide)
const AnalysisPage = lazy(() => import('@/components/analysis/AnalysisPage').then((m) => ({ default: m.AnalysisPage })));
const BoardPage = lazy(() => import('@/components/board/BoardPage').then((m) => ({ default: m.BoardPage })));
const SettingsPage = lazy(() => import('@/components/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PlaybookPage = lazy(() => import('@/components/team/PlaybookPage').then((m) => ({ default: m.PlaybookPage })));
const ReviewsPage = lazy(() => import('@/components/team/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const PrepPage = lazy(() => import('@/components/prep/PrepPage').then((m) => ({ default: m.PrepPage })));
const CalendarPage = lazy(() => import('@/components/team/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const PageLoading = () => <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{tt('Loading…')}</div>;
import { Viewer } from '@/components/Viewer';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LibraryPanel } from '@/components/LibraryPanel';
import { listMatches, saveMatch, summarize, type LibraryMatch } from '@/library/library';
import { demoId, loadScrim } from '@/scrim/storage';
import { BoardsPanel } from '@/components/board/BoardsPanel';
import { FaceitPanel } from '@/components/FaceitPanel';
import { listBoards, saveBoard } from '@/board/storage';
import type { Board } from '@/board/types';
import { setFinderMode } from '@/app/finder';
import { ANALYSIS_TABS, navigate, REPLAY_VIEWS, useRoute } from '@/app/router';
import { useCommands, type Command } from '@/app/commands';
import { setPresentation, toggleDock, usePresentation } from '@/app/layout';
import { Sidebar } from '@/components/shell/Sidebar';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog';
import { CoachChat, libraryScope } from '@/components/CoachPanel';
import { setLang, tt } from '@/i18n';

/** Round à ouvrir une fois la démo chargée (depuis l'analyse : les démos ne sont pas stockées). */
interface PendingRound { id: string; round: number; fileName: string; queue?: number[] }

const SIDEBAR_KEY = 'scrimview.sidebar';
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);

const TAB_LABEL: Record<string, string> = { players: tt('Player stats'), training: tt('Training'), teams: tt('Team stats'), series: tt('Series'), rounds: tt('Rounds'), strategies: tt('Detected strats'), heatmaps: tt('Heatmaps'), lineups: tt('Lineups & nade finder'), brief: tt('Anti-strat brief'), veto: tt('Veto') };

export default function App() {
  const route = useRoute();
  const presentation = usePresentation();
  const [match, setMatch] = useState<MatchData | null>(null);
  const [matchFile, setMatchFile] = useState<File | null>(null);
  const [startRound, setStartRound] = useState<number | null>(null);
  const [queueRounds, setQueueRounds] = useState<number[] | null>(null);
  const [progress, setProgress] = useState<{ step: string; ratio: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; } });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryMatch[] | null>(null);
  const pending = useRef<PendingRound | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);

  // Tiroir fermé à chaque changement de page
  useEffect(() => { setDrawer(false); }, [route]);
  useEffect(() => { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* ignoré */ } }, [collapsed]);

  // Quitter le replay ferme le mode présentation
  useEffect(() => { if (route.page !== 'replay' && presentation.on) setPresentation({ on: false }); }, [route.page, presentation.on]);
  // Pas de démo en mémoire (rechargement de la page) : le replay n'existe plus, retour à l'accueil
  useEffect(() => { if (route.page === 'replay' && !match && !progress) navigate({ page: 'home' }, true); }, [route, match, progress]);
  // Tableau demandé par l'adresse
  useEffect(() => {
    if (route.page !== 'board') { setBoard(null); return; }
    if (board?.id === route.id) return;
    listBoards().then((all) => { const b = all.find((x) => x.id === route.id); if (b) setBoard(b); else navigate({ page: 'boards' }, true); });
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  // Le coach de la bibliothèque lit les matchs à l'ouverture
  useEffect(() => { if (coachOpen && route.page !== 'replay') listMatches().then(setLibrary); }, [coachOpen, route.page]);

  const open = async (file: File, want: PendingRound | null = null) => {
    setError(null);
    setNotice(null);
    setProgress({ step: 'loading', ratio: 0 });
    const t = performance.now();
    try {
      const m = await loadDemo(file, (step, ratio) => setProgress({ step, ratio }));
      m.timings.total = Math.round(performance.now() - t);
      console.info('[scrimview] parsed', file.name, m.timings);
      if (want && demoId(m) !== want.id) {
        setNotice(tt('{0} is not the demo of this round: pick {1}.', [file.name, want.fileName]));
        return;
      }
      (window as unknown as { __match?: MatchData }).__match = m;
      setStartRound(want ? want.round : null);
      setQueueRounds(want?.queue ?? null);
      setMatch(m);
      setMatchFile(file);
      navigate({ page: 'replay', view: 'replay' });
      // Ajout automatique à la bibliothèque locale (stats seulement)
      saveMatch(summarize(m, file.lastModified));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (want) setNotice(msg); else setError(msg);
    } finally {
      setProgress(null);
    }
  };

  // Rouvrir un round depuis l'analyse : la démo déjà ouverte si c'est la bonne, sinon on demande le fichier
  const openRound = (lm: LibraryMatch, round: number, queue?: number[]) => {
    if (match && demoId(match) === lm.id) {
      setQueueRounds(queue ?? null);
      setStartRound(round);
      navigate({ page: 'replay', view: 'replay' });
      return;
    }
    pending.current = { id: lm.id, round, fileName: lm.fileName, queue };
    const input = pickRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  // Rouvrir une démo par son identifiant (playbook, reviews) : celle ouverte, sinon on demande le fichier
  const openDemo = async (id: string, round: number) => {
    const lm = (await listMatches()).find((m) => m.id === id);
    const fileName = lm?.fileName ?? (await loadScrim(id))?.demo.fileName ?? 'the demo';
    openRound((lm ?? { id, fileName }) as LibraryMatch, Math.max(0, round));
  };

  const toggleCoach = () => { if (route.page === 'replay') toggleDock('coach'); else setCoachOpen((o) => !o); };

  // Raccourcis globaux
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (typing(e.target) || document.querySelector('[role=dialog]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); setHelpOpen(true); }
      else if (e.key === '[') setCollapsed((c) => !c);
      else if (e.key === 'c' || e.key === 'C') toggleCoach();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Commandes de navigation
  const navCommands = useMemo<Command[]>(() => [
    { id: 'nav.home', title: tt('Dashboard'), group: tt('Go to'), keywords: 'home start', run: () => navigate({ page: 'home' }) },
    { id: 'nav.library', title: tt('Library'), group: tt('Go to'), keywords: 'demos import folder', run: () => navigate({ page: 'library' }) },
    { id: 'nav.settings.team', title: tt('Settings: My team'), group: tt('Go to'), keywords: 'roster players logo', run: () => navigate({ page: 'settings', section: 'team' }) },
    { id: 'nav.settings.3d', title: tt('Settings: 3D maps & models'), group: tt('Go to'), keywords: 'install extract workshop agents', run: () => navigate({ page: 'settings', section: '3d' }) },
    { id: 'nav.settings.display', title: tt('Settings: Display'), group: tt('Go to'), keywords: 'colors theme', run: () => navigate({ page: 'settings', section: 'display' }) },
    ...ANALYSIS_TABS.map((t) => ({ id: `nav.${t}`, title: TAB_LABEL[t], group: tt('Go to'), keywords: 'analysis', run: () => navigate({ page: 'analysis', tab: t }) })),
    { id: 'nav.finder', title: tt('Nade finder'), group: tt('Go to'), keywords: 'grenade lineup smoke flash molotov where land', run: () => { setFinderMode('to'); navigate({ page: 'analysis', tab: 'lineups' }); } },
    { id: 'nav.playbook', title: tt('Playbook'), group: tt('Go to'), keywords: 'strats strategies executes', run: () => navigate({ page: 'playbook' }) },
    { id: 'nav.reviews', title: tt('Reviews'), group: tt('Go to'), keywords: 'notes markers vod sessions', run: () => navigate({ page: 'reviews' }) },
    { id: 'nav.prep', title: tt('Match prep'), group: tt('Go to'), keywords: 'anti-strat opponent scout prepare veto counter', run: () => navigate({ page: 'prep' }) },
    { id: 'nav.calendar', title: tt('Calendar'), group: tt('Go to'), keywords: 'schedule scrims officials', run: () => navigate({ page: 'calendar' }) },
    { id: 'nav.boards', title: tt('Boards'), group: tt('Go to'), keywords: 'tactical board strat', run: () => navigate({ page: 'boards' }) },
    ...(match ? REPLAY_VIEWS.map((v) => ({ id: `nav.replay.${v}`, title: tt('Replay: {0}{1}', [v[0].toUpperCase(), v.slice(1)]), group: tt('Go to'), keywords: 'match demo viewer', run: () => navigate({ page: 'replay', view: v }) })) : []),
    { id: 'app.open-demo', title: tt('Open a demo…'), group: tt('Actions'), keywords: 'file load dem', run: () => { pending.current = null; if (pickRef.current) { pickRef.current.value = ''; pickRef.current.click(); } } },
    { id: 'app.coach', title: tt('Toggle coach'), group: tt('Actions'), shortcut: 'C', keywords: 'ai assistant ask', run: toggleCoach },
    { id: 'app.sidebar', title: tt('Collapse / expand sidebar'), group: tt('Actions'), shortcut: '[', run: () => setCollapsed((c) => !c) },
    { id: 'app.lang.fr', title: tt('Langue : Français'), group: tt('Actions'), keywords: 'language french francais langue', run: () => setLang('fr') },
    { id: 'app.lang.en', title: tt('Language: English'), group: tt('Actions'), keywords: 'language english anglais langue', run: () => setLang('en') },
    { id: 'app.shortcuts', title: tt('Keyboard shortcuts'), group: tt('Actions'), shortcut: '?', run: () => setHelpOpen(true) },
  ], [match, route.page]); // eslint-disable-line react-hooks/exhaustive-deps
  useCommands('app', navCommands);

  const libScope = useMemo(() => (library ? libraryScope(library) : null), [library]);
  const last = match?.rounds[match.rounds.length - 1];
  const REPLAY_LABEL: Record<string, string> = { replay: tt('Replay'), '3d': tt('Replay in 3D'), overlay: tt('Overlay'), grenades: tt('Grenades'), stats: tt('Stats') };
  const pageTitle = route.page === 'home' ? tt('Dashboard') : route.page === 'library' ? tt('Library') : route.page === 'analysis' ? TAB_LABEL[route.tab] ?? ''
    : route.page === 'replay' && match ? `${match.header.map.replace(/^de_/, '')} · ${REPLAY_LABEL[route.view] ?? ''}` : route.page === 'settings' ? tt('Settings')
    : route.page === 'boards' || route.page === 'board' ? tt('Boards') : route.page === 'playbook' ? tt('Playbook') : route.page === 'reviews' ? tt('Reviews') : route.page === 'calendar' ? tt('Calendar') : route.page === 'prep' ? tt('Match prep') : '';
  const showCoachDrawer = coachOpen && route.page !== 'replay' && route.page !== 'board';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
      {isDesktop && !(presentation.on && route.page === 'replay') && <TitleBar title={pageTitle} onSearch={() => setPaletteOpen(true)} />}
      {narrow && route.page !== 'board' && !(presentation.on && route.page === 'replay') && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 print:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }} data-testid="mobile-bar">
          <Button size="icon-sm" variant="ghost" aria-label={tt('Menu')} onClick={() => setDrawer(true)}><Menu /></Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{pageTitle || tt('Celeste CS2')}</span>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Search')} onClick={() => setPaletteOpen(true)}><Search /></Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {route.page !== 'board' && !(presentation.on && route.page === 'replay') && (!narrow || drawer) && (
          <div className={narrow ? 'fixed inset-0 z-40 flex' : 'contents'} onClick={narrow ? (e) => { if (e.target === e.currentTarget) setDrawer(false); } : undefined}>
            {narrow && <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />}
            <div className={narrow ? 'relative h-full bg-background shadow-xl' : 'contents'} style={narrow ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
              <Sidebar route={route} collapsed={narrow ? false : collapsed} onCollapse={() => (narrow ? setDrawer(false) : setCollapsed((c) => !c))}
                match={match ? { map: match.header.map, fileName: match.source.fileName, score: last ? `${last.scoreAfter[0]}–${last.scoreAfter[1]}` : '' } : null}
                coachOpen={route.page === 'replay' ? false : coachOpen} onCoach={() => { setDrawer(false); toggleCoach(); }} onPalette={() => { setDrawer(false); setPaletteOpen(true); }} onShortcuts={() => setHelpOpen(true)} />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {match && (
              <div className={route.page === 'replay' ? 'h-full' : 'hidden'}>
                <Viewer key={demoId(match) + (startRound ?? '')} match={match} file={matchFile} startRound={startRound} queueRounds={queueRounds}
                  active={route.page === 'replay'} view={route.page === 'replay' ? route.view : 'replay'}
                  onView={(v) => navigate({ page: 'replay', view: v })}
                  onClose={() => { setMatch(null); setMatchFile(null); navigate({ page: 'home' }); }}
                  onBoard={async (b) => { await saveBoard(b); setBoard(b); navigate({ page: 'board', id: b.id }); }} />
              </div>
            )}
            <Suspense fallback={<PageLoading />}>
              {route.page === 'board' && board && <BoardPage key={board.id} board={board} onClose={() => (history.length > 1 ? history.back() : navigate({ page: 'boards' }))} />}
              {route.page === 'analysis' && <AnalysisPage tab={route.tab} onOpenRound={openRound} notice={notice} />}
              {route.page === 'settings' && <SettingsPage section={route.section} />}
              {route.page === 'playbook' && <PlaybookPage onOpenClip={openDemo} />}
              {route.page === 'reviews' && <ReviewsPage onOpen={openDemo} />}
              {route.page === 'calendar' && <CalendarPage />}
              {route.page === 'prep' && <PrepPage team={route.team} onOpenRound={openRound} />}
            </Suspense>
            {route.page === 'boards' && (
              <div className="h-full overflow-y-auto p-6">
                <div className="mx-auto max-w-3xl space-y-3">
                  <h1 className="text-lg font-semibold">{tt('Boards')}</h1>
                  <BoardsPanel onOpen={(b) => { setBoard(b); navigate({ page: 'board', id: b.id }); }} />
                </div>
              </div>
            )}
            {route.page === 'home' && (
              <Dashboard dropZone={<DropZone onFile={open} progress={progress} error={error} />}
                current={match ? { map: match.header.map, score: last ? `${last.scoreAfter[0]}–${last.scoreAfter[1]}` : '' } : null} />
            )}
            {route.page === 'library' && (
              <div className="flex h-full flex-col items-center gap-3 overflow-y-auto p-6">
                <LibraryPanel onAnalysis={() => navigate({ page: 'analysis', tab: 'players' })} />
                <BoardsPanel onOpen={(b) => { setBoard(b); navigate({ page: 'board', id: b.id }); }} />
                <FaceitPanel onFile={(f) => open(f)} />
              </div>
            )}
          </div>
          {showCoachDrawer && (
            <aside className="w-[400px] shrink-0 p-2 pl-0 print:hidden">
              {libScope ? <CoachChat scope={libScope} onClose={() => setCoachOpen(false)} /> : null}
            </aside>
          )}
        </div>
      </div>
      </div>
      <input ref={pickRef} type="file" accept=".dem,.zst,.gz,.dem.zst,.dem.gz" className="hidden" data-testid="round-picker"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f, pending.current); }} />
      {isDesktop && <SetupWizard />}
      {route.page !== 'home' && progress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-72 space-y-2 rounded-xl border bg-card p-4 text-sm">
            <div className="flex justify-between"><span>{tt('Opening') + ' '}{pending.current?.fileName ?? 'demo'}</span><span className="num text-muted-foreground">{Math.round(progress.ratio * 100)}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.ratio * 100}%` }} /></div>
          </div>
        </div>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </TooltipProvider>
  );
}
