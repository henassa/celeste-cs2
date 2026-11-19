// Panneau FACEIT (écran d'accueil) : clé API personnelle, profil, derniers matchs CS2 avec les stats
// FACEIT, repère « dans la bibliothèque », lien vers la salle de match pour télécharger la démo.

import { useEffect, useState } from 'react';
import { ExternalLink, Download, KeyRound, Loader2, Search } from 'lucide-react';
import { faceit, FaceitError, getFaceitKey, matchIdFromFileName, matchRoomUrl, resultFor, setFaceitKey, type FaceitHistoryItem, type FaceitPlayer, type FaceitPlayerStats } from '@/faceit/api';
import { listMatches } from '@/library/library';
import { mapDisplayName } from '@/maps/maps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

const NICK = 'scrimview.faceitNick';

export function FaceitPanel({ onFile }: { onFile: (f: File) => void }) {
  const [key, setKey] = useState(getFaceitKey);
  const [draftKey, setDraftKey] = useState('');
  const [nick, setNick] = useState(() => { try { return localStorage.getItem(NICK) ?? ''; } catch { return ''; } });
  const [player, setPlayer] = useState<FaceitPlayer | null>(null);
  const [history, setHistory] = useState<FaceitHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, { map: string; me?: FaceitPlayerStats } | 'loading' | string>>({});
  const [dl, setDl] = useState<Record<string, string>>({});

  useEffect(() => { listMatches().then((ms) => setInLibrary(new Set(ms.map((m) => matchIdFromFileName(m.fileName)).filter((x): x is string => !!x)))); }, []);

  const load = async () => {
    if (!key || !nick.trim()) return;
    setLoading(true); setError(null);
    try {
      try { localStorage.setItem(NICK, nick.trim()); } catch { /* ignoré */ }
      const p = await faceit.player(nick.trim(), key);
      setPlayer(p);
      setHistory(await faceit.history(p.player_id, key, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const expand = async (id: string) => {
    setOpen(open === id ? null : id);
    if (stats[id] || !player) return;
    setStats((s) => ({ ...s, [id]: 'loading' }));
    try {
      const st = await faceit.matchStats(id, key);
      setStats((s) => ({ ...s, [id]: { map: st.map, me: st.players.find((x) => x.player_id === player.player_id) } }));
    } catch (e) { setStats((s) => ({ ...s, [id]: e instanceof Error ? e.message : 'Error' })); }
  };

  const download = async (id: string) => {
    setDl((d) => ({ ...d, [id]: 'Asking FACEIT…' }));
    try {
      const m = await faceit.match(id, key);
      const url = m.demo_url?.[0];
      if (!url) throw new FaceitError('No demo for this match yet.', 0);
      const signed = await faceit.demoDownloadUrl(url, key);
      setDl((d) => ({ ...d, [id]: 'Downloading…' }));
      const res = await fetch(signed);
      if (!res.ok) throw new FaceitError(`Download failed (${res.status}).`, res.status);
      const blob = await res.blob();
      const name = url.split('/').pop() || `${id}.dem.zst`;
      setDl((d) => ({ ...d, [id]: '' }));
      onFile(new File([blob], name, { lastModified: Date.now() }));
    } catch (e) {
      const st = e instanceof FaceitError ? e.status : 0;
      setDl((d) => ({ ...d, [id]: st === 401 || st === 403
        ? 'Automatic download needs FACEIT Downloads API access. Use “Match room” to download the demo, then drop it here.'
        : e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="faceit-panel">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm font-medium">{tt('FACEIT')}</span>
        <span className="text-xs text-muted-foreground">{tt('your matches with your own API key')}</span>
        <span className="flex-1" />
        {key ? (
          <>
            <Input value={nick} onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder={tt('FACEIT nickname')} className="h-8 w-48 text-sm" aria-label={tt('FACEIT nickname')} />
            <Button size="sm" onClick={load} disabled={loading || !nick.trim()}>{loading ? <Loader2 className="animate-spin" /> : <Search />} {tt('Load')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFaceitKey(''); setKey(''); setPlayer(null); setHistory([]); }}>{tt('Forget key')}</Button>
          </>
        ) : (
          <>
            <Input type="password" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder={tt('Client-side API key')} className="h-8 w-64 text-sm" aria-label={tt('FACEIT API key')} />
            <Button size="sm" disabled={!draftKey.trim()} onClick={() => { setFaceitKey(draftKey); setKey(draftKey.trim()); setDraftKey(''); }}><KeyRound /> {tt('Save key')}</Button>
          </>
        )}
      </div>
      {!key && (
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          {tt('Free key: developers.faceit.com → App Studio → your app → API Keys → a') + ' '}<span className="text-foreground">{tt('client-side')}</span> {tt('key. It stays in this browser and is only sent to FACEIT. Celeste shows your matches and FACEIT stats; demos are private on FACEIT, so you download them from the match room (one click) and drop them here.')}
        </p>
      )}
      {error && <p className="border-t px-4 py-2 text-xs text-destructive">{error}</p>}
      {player && (
        <div className="border-t">
          <div className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="font-medium">{player.nickname}</span>
            {player.games?.cs2 && <span className="num text-xs text-muted-foreground">{tt('level') + ' '}{player.games.cs2.skill_level ?? '?'} · {player.games.cs2.faceit_elo ?? '?'} {tt('Elo')}</span>}
            <span className="text-xs text-muted-foreground">{history.length} {tt('recent matches')}</span>
          </div>
          <ul>
            {history.map((h) => {
              const r = resultFor(h, player.player_id);
              const st = stats[h.match_id];
              return (
                <li key={h.match_id} className="border-t">
                  <div className="flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-accent/40">
                    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => expand(h.match_id)}>
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">{new Date(h.finished_at * 1000).toLocaleDateString(locale)}</span>
                      <span className={cn('w-10 shrink-0 text-xs', r.won ? 'font-medium' : 'text-muted-foreground')}>{r.won === null ? '—' : r.won ? tt('Win') : tt('Loss')}</span>
                      <span className="num w-14 shrink-0">{r.score}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tt('vs') + ' '}{r.theirs}{typeof st === 'object' && st.map ? ` · ${mapDisplayName(st.map)}` : ''}</span>
                    </button>
                    {inLibrary.has(h.match_id.toLowerCase()) && <span className="rounded-sm border px-1.5 text-[10px] text-muted-foreground">{tt('In library')}</span>}
                    <a href={matchRoomUrl(h.match_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /> {tt('Match room')}</a>
                    <Button size="xs" variant="ghost" onClick={() => download(h.match_id)} title={tt('Needs FACEIT Downloads API access')}><Download /> {tt('Demo')}</Button>
                  </div>
                  {dl[h.match_id] && <p className="px-4 pb-1.5 text-[11px] text-muted-foreground">{dl[h.match_id]}</p>}
                  {open === h.match_id && (
                    <div className="px-4 pb-2 text-xs text-muted-foreground">
                      {st === 'loading' ? tt('Loading FACEIT stats…') : typeof st === 'string' ? st : st?.me ? (
                        <span className="num">
                          {['Kills', 'Deaths', 'Assists', 'ADR', 'K/D Ratio', 'Headshots %', 'MVPs'].filter((k) => st.me!.stats[k] !== undefined).map((k) => `${k} ${st.me!.stats[k]}`).join(' · ')}
                        </span>
                      ) : tt('No stats.')}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
