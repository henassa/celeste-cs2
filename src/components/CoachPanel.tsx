// Coach : fil de discussion partagé par le replay (périmètre : le match ouvert) et l'analyse
// (périmètre : la bibliothèque). Le modèle va chercher les faits avec des outils locaux ; les
// outils appelés sont affichés dans le fil, et les rounds cités (R12) sont cliquables.

import { useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Settings2, Trash2, Wrench, X } from 'lucide-react';
import type { Playback } from '@/viewer/playback';
import type { ScrimStore } from '@/scrim/store';
import { matchContext, QUICK_PROMPTS, systemPrompt } from '@/coach/context';
import { loadCoachSettings, privacyNote, type ChatMessage } from '@/coach/providers';
import { askCoach } from '@/coach/agent';
import { libraryTools, matchTools, type ToolDef } from '@/coach/tools';
import type { LibraryMatch } from '@/library/library';
import { aimBasic, summarizeAim } from '@/stats/aim';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { navigate } from '@/app/router';
import { CoachSettingsDialog, loadCoachLang } from './CoachSettings';
import { tt } from '@/i18n';

interface Entry { role: 'user' | 'assistant'; content: string; tools?: string[] }

/** Rendu minimal (gras, listes, titres, R# cliquables), sans HTML injecté. */
function Formatted({ text, onRound }: { text: string; onRound?: (r: number) => void }) {
  const inline = (s: string, key: number) => s.split(/(\*\*[^*]+\*\*|\bR\d{1,2}\b)/g).map((p, j) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}-${j}`} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (onRound && /^R\d{1,2}$/.test(p)) return <button key={`${key}-${j}`} type="button" className="rounded px-0.5 font-mono underline decoration-dotted underline-offset-2 hover:bg-accent" onClick={() => onRound(Number(p.slice(1)) - 1)}>{p}</button>;
    return p;
  });
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        const h = /^#{1,4}\s+/.test(line);
        const bullet = /^\s*([-*•]|\d+\.)\s+/.test(line);
        const body = line.replace(/^#{1,4}\s+/, '').replace(/^\s*([-*•])\s+/, '');
        return (
          <p key={i} className={cn(h && 'pt-1 font-semibold text-foreground', bullet && 'pl-3 before:mr-1.5 before:-ml-3 before:content-["·"]', !line.trim() && 'h-1')}>
            {inline(body, i)}
          </p>
        );
      })}
    </div>
  );
}

export interface CoachScope {
  kind: 'match' | 'library';
  tools: () => ToolDef[];
  /** Contexte complet, pour les modèles sans outils. */
  fallback: () => string;
  quick: { label: string; prompt: string }[];
  placeholder: string;
  onRound?: (r: number) => void;
  /** Le coach vient de poser des zones sur une carte. */
  onZones?: () => void;
}

export function CoachChat({ scope, onClose, className }: { scope: CoachScope; onClose?: () => void; className?: string }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const settings = useMemo(() => loadCoachSettings(), [settingsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [history, setHistory] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<ToolDef[] | null>(null);
  const scroll = () => listRef.current?.scrollTo({ top: listRef.current.scrollHeight });

  const ask = async (question: string) => {
    if (busy || !question.trim()) return;
    setError(null); setBusy(true); setDraft('');
    const prior: ChatMessage[] = history.map((h) => ({ role: h.role, content: h.content }));
    setHistory((h) => [...h, { role: 'user', content: question }, { role: 'assistant', content: '', tools: [] }]);
    const patch = (fn: (e: Entry) => Entry) => setHistory((h) => [...h.slice(0, -1), fn(h[h.length - 1])]);
    try {
      toolsRef.current ??= scope.tools();
      const answer = await askCoach(settings, systemPrompt(loadCoachLang(), scope.kind), prior, question, toolsRef.current, scope.fallback, {
        onToken: (t) => { patch((e) => ({ ...e, content: t })); scroll(); },
        onStatus: setStatus,
        onTool: (name, args) => { if (name === 'show_on_map') setTimeout(() => scope.onZones?.(), 0); patch((e) => ({ ...e, tools: [...(e.tools ?? []), `${name}${Object.keys(args).length ? ` ${Object.values(args).map((v) => (typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : v)).join(', ')}` : ''}`] })); },
      });
      patch((e) => ({ ...e, content: answer || '(empty answer)' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHistory((h) => h.slice(0, -2));
      setDraft(question);
    } finally { setBusy(false); setStatus(''); }
  };

  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground', className)} data-testid="coach-panel">
      <div className="flex items-center gap-2 px-4 py-3">
        <Bot className="size-4" />
        <span className="text-sm font-medium">{tt('Coach')}</span>
        <span className="text-[11px] text-muted-foreground">{scope.kind === 'match' ? 'this match' : 'your library'}</span>
        <span className="flex-1" />
        {history.length > 0 && <Button size="icon-xs" variant="ghost" disabled={busy} onClick={() => setHistory([])} aria-label={tt('Clear conversation')}><Trash2 /></Button>}
        <Button size="icon-xs" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label={tt('Coach settings')}><Settings2 /></Button>
        {onClose && <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={tt('Close coach')}><X /></Button>}
      </div>
      <p className="border-t px-4 py-1.5 text-[11px] text-muted-foreground">{privacyNote(settings)}</p>
      <div className="flex flex-wrap gap-1 border-t px-4 py-2">
        {scope.quick.map((q) => <Button key={q.label} size="xs" variant="outline" disabled={busy} onClick={() => ask(q.prompt)}>{q.label}</Button>)}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t px-4 py-3 text-xs">
        {history.length === 0 && (
          <p className="text-muted-foreground">
            {scope.kind === 'match'
              ? tt('Ask about the match. The coach looks up rounds, players, teams, utility and your notes by itself, then answers with the rounds as evidence (click R12 to jump there).')
              : tt('Ask about your library: a player’s progress, an opponent’s habits, the veto, what to practice. The coach looks up the data by itself.')}
          </p>
        )}
        {history.map((msg, i) => (
          <div key={i} className={cn(msg.role === 'user' ? 'ml-6 rounded-lg bg-accent/60 px-3 py-2' : 'leading-relaxed')}>
            {msg.tools && msg.tools.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1" data-testid="coach-tools">
                {msg.tools.map((t, j) => <span key={j} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"><Wrench className="size-2.5" />{t}</span>)}
              </div>
            )}
            {msg.role === 'assistant' && !msg.content && busy && i === history.length - 1
              ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {status || tt('Thinking…')}</span>
              : <Formatted text={msg.content} onRound={scope.onRound} />}
          </div>
        ))}
        {error && <p className="text-destructive">{error}</p>}
      </div>
      <div className="space-y-2 border-t p-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('{0} (Enter to send)', [scope.placeholder])} className="min-h-14 resize-none text-xs"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
        <p className="text-[10px] text-muted-foreground">{tt('AI answers can be wrong: check the rounds it cites.')}</p>
      </div>
      <CoachSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={() => { setSettingsVersion((v) => v + 1); }} />
    </div>
  );
}

/** Coach du replay : le match ouvert. */
export function CoachPanel({ pb, scrim, roundIndex, onClose }: { pb: Playback; scrim: ScrimStore; roundIndex: number; onClose: () => void }) {
  const m = pb.match;
  const follow = pb.get().follow;
  const scope = useMemo<CoachScope>(() => ({
    kind: 'match',
    tools: () => matchTools(m, scrim.doc.roundNotes),
    fallback: () => matchContext(m, { round: roundIndex, notes: scrim.doc.roundNotes, aim: summarizeAim(m, aimBasic(m), null) }),
    quick: [
      { label: tt('Match verdict'), prompt: QUICK_PROMPTS.verdict },
      { label: tt('Round {0}', [roundIndex + 1]), prompt: QUICK_PROMPTS.round(roundIndex + 1) },
      { label: tt('What to practice'), prompt: QUICK_PROMPTS.practice },
      { label: tt('Economy'), prompt: 'How did each team manage its economy? Which buys or saves cost rounds, with round numbers.' },
      { label: tt('Positions'), prompt: 'Which positions won and lost fights for each team in this match? Show the strongest and weakest ones on the map.' },
      { label: tt('Their T side'), prompt: 'Break down the opponent T side: what they execute, when, with which utility, and how we should set up against it.' },
      ...(follow >= 0 ? [{ label: m.players[follow].name, prompt: QUICK_PROMPTS.player(m.players[follow].name) }] : []),
    ],
    placeholder: tt('Why did we lose the eco rounds?'),
    onRound: (r) => { if (r >= 0 && r < m.rounds.length) pb.goToRound(r); },
  }), [m, scrim, roundIndex, follow, pb]);
  return <CoachChat scope={scope} onClose={onClose} />;
}

/** Coach de l'analyse : toute la bibliothèque. */
export function libraryScope(matches: LibraryMatch[], onOpenRound?: (r: number) => void): CoachScope {
  return {
    kind: 'library',
    tools: () => libraryTools(matches),
    fallback: () => libraryTools(matches).filter((t) => t.name === 'library_overview').map((t) => t.run({})).join('\n'),
    quick: [
      { label: tt('Overview'), prompt: 'Give me an overview of the library: which teams and players, how they are doing, and the 3 things that stand out.' },
      { label: tt('Prepare an opponent'), prompt: 'Which opponent appears most in the library? Prepare an anti-strat summary for our next match against them.' },
      { label: tt('Strong positions'), prompt: 'What are the strong and weak positions on our most played map? Show them on the map.' },
      { label: tt('Veto'), prompt: 'Compare our map pool with our most frequent opponent and suggest a BO3 veto with reasons.' },
      { label: tt('Training plan'), prompt: 'Build a one-week training plan for our team from the weak points in the data.' },
    ],
    placeholder: tt('How does our AWPer do on Mirage?'),
    onRound: onOpenRound,
    onZones: () => navigate({ page: 'analysis', tab: 'heatmaps' }),
  };
}
