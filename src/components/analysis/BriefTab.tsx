// Onglet Brief : fiche anti-strat d'une équipe sur une carte, à lire avant le match,
// à copier en Markdown (Discord, Notion) ou à imprimer / enregistrer en PDF.

import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, FileDown, Printer, TriangleAlert } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { RatingModel } from '@/calib/model';
import type { Subject } from '@/analysis/heatmap';
import { briefMarkdown, buildBrief, subjectMaps, type Ratio } from '@/analysis/brief';
import type { Lineup } from '@/analysis/lineups';
import type { Trend } from '@/analysis/rounds';
import { techLabel } from '@/analysis/lineups';
import { mapDisplayName } from '@/maps/maps';
import { placeLabel } from '@/viewer/places';
import { downloadBlob, safeName } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { copyText } from '../CopySetpos';
import { locale, tt } from '@/i18n';

const p = (r: Ratio) => (r.played ? `${Math.round((r.won / r.played) * 100)}%` : '—');
const n = (r: Ratio) => (r.played ? `${r.won}/${r.played}` : '');
const clock = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };
const LEVEL = { habit: 'habit', recurring: 'recurring', oneoff: 'one-off' } as const;

function Stat({ label, r }: { label: string; r: Ratio }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold">{p(r)}</div>
      <div className="num text-xs text-muted-foreground">{n(r) || '—'}</div>
    </div>
  );
}

function Trends({ title, items }: { title: string; items: Trend[] }) {
  return (
    <div>
      <div className="text-xs font-medium">{title}</div>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">{tt('No data.')}</p> : (
        <ul className="mt-1 space-y-0.5 text-xs">
          {items.slice(0, 4).map((t) => (
            <li key={t.key} className="flex gap-2">
              <span className="flex-1">{placeLabel(t.key)}</span>
              <span className="num text-muted-foreground">{t.rounds}/{t.of}</span>
              <span className="w-16 text-right text-muted-foreground">{LEVEL[t.level]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lineups({ items }: { items: Lineup[] }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{tt('No grenade thrown twice from the same spot yet.')}</p>;
  return (
    <ul className="space-y-0.5 text-xs">
      {items.map((l) => (
        <li key={l.id} className="flex gap-2">
          <span className="w-14 text-muted-foreground capitalize">{l.kind === 'molotov' ? 'molly' : l.kind}</span>
          <span className="flex-1">{placeLabel(l.toPlace) || '—'} <span className="text-muted-foreground">{tt('from') + ' '}{placeLabel(l.fromPlace) || '—'} · {techLabel(l.tech).toLowerCase()}</span></span>
          <span className="num text-muted-foreground">{l.throws.length}× · {l.maps} {tt('map')}{l.maps === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  matches: LibraryMatch[];
  map?: string;
  onMapChange: (map: string) => void;
  subject: Subject;
  model3?: RatingModel;
  subjectPicker: React.ReactNode;
}

export function BriefTab({ matches, map: mapProp, onMapChange, subject, model3, subjectPicker }: Props) {
  const maps = useMemo(() => subjectMaps(matches, subject), [matches, subject]);
  const map = mapProp && maps.includes(mapProp) ? mapProp : maps[0] ?? '';
  const b = useMemo(() => (map ? buildBrief(matches, map, subject, model3) : null), [matches, map, subject, model3]);
  const [copied, setCopied] = useState(false);
  const md = b ? briefMarkdown(b, mapDisplayName(map)) : '';
  const fileBase = b ? safeName(`brief_${b.teamName}_${map}`) : 'brief';

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2 print:block">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4 print:hidden">
        <div className="space-y-1">
          <div className="text-sm font-medium">{tt('Anti-strat brief')}</div>
          <p className="text-xs text-muted-foreground">{tt('Pick a team (or a player, to scout the teams they played in) and a map.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Team')}</div>
          {subjectPicker}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Map')}</div>
          <Select value={map} onValueChange={onMapChange}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{maps.map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2 border-t pt-3">
          <Button size="sm" variant="outline" className="w-full" disabled={!b} onClick={async () => { if (await copyText(md)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
            {copied ? <Check /> : <ClipboardCopy />} {copied ? tt('Copied') : tt('Copy as Markdown')}
          </Button>
          <Button size="sm" variant="outline" className="w-full" disabled={!b} onClick={() => downloadBlob(new Blob([md], { type: 'text/markdown' }), `${fileBase}.md`)}>
            <FileDown /> {tt('Download .md')}
          </Button>
          <Button size="sm" variant="outline" className="w-full" disabled={!b} onClick={() => window.print()}>
            <Printer /> {tt('Print or save as PDF')}
          </Button>
          <p className="text-[11px] text-muted-foreground">{tt('Markdown pastes cleanly in Discord and Notion. Nothing leaves your computer unless you share it.')}</p>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto print:overflow-visible">
        {subject.kind === 'all' ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('Choose a team or a player on the left.')}</div>
        ) : !b ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('No demo of this team on') + ' '}{mapDisplayName(map)} {tt('in your library.')}</div>
        ) : (
          <article className="brief mx-auto max-w-4xl space-y-6 rounded-xl border bg-card p-8 print:border-0 print:p-0">
            <header className="space-y-1 border-b pb-4">
              <div className="text-xs tracking-wide text-muted-foreground uppercase">{tt('Anti-strat brief ·') + ' '}{mapDisplayName(map)}</div>
              <h1 className="text-2xl font-semibold">{b.teamName}</h1>
              <p className="text-sm text-muted-foreground">
                {b.maps} {tt('map')}{b.maps === 1 ? '' : 's'} · {b.rounds} {tt('rounds')}
                {b.dates && <> · {new Date(b.dates[0]).toLocaleDateString(locale)} – {new Date(b.dates[1]).toLocaleDateString(locale)}</>}
                {' '}{tt('· record') + ' '}<span className="num text-foreground">{b.record.won}–{b.record.lost}{b.record.tied ? `–${b.record.tied}` : ''}</span>
              </p>
              {b.small && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><TriangleAlert className="size-3.5" /> {tt('Small sample: treat these as hints, not habits. Add more demos of this team to firm them up.')}</p>}
            </header>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{tt('Key points')}</h2>
              {b.takeaways.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">{b.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
              ) : <p className="text-sm text-muted-foreground">{tt('Nothing stands out with this sample.')}</p>}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{tt('Results')}</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label={tt('CT rounds')} r={b.ct} />
                <Stat label={tt('T rounds')} r={b.t} />
                <Stat label={tt('Pistol rounds')} r={b.pistol} />
                <Stat label={tt('Opening duels won')} r={{ won: b.summary.all.openingWon, played: b.summary.all.openingPlayed }} />
                <Stat label={tt('After a won pistol')} r={b.afterPistolWin} />
                <Stat label={tt('After a lost pistol')} r={b.afterPistolLoss.result} />
                <Stat label={tt('Won after opening kill')} r={b.summary.all.winWithOpening} />
                <Stat label={tt('Won after opening death')} r={b.summary.all.winWithoutOpening} />
              </div>
              {b.afterPistolLoss.result.played > 0 && (
                <p className="text-xs text-muted-foreground">
                  {tt('Buy after a lost pistol: eco') + ' '}{b.afterPistolLoss.buys.eco}{tt(', force') + ' '}{b.afterPistolLoss.buys.force}{tt(', full') + ' '}{b.afterPistolLoss.buys.full}.
                </p>
              )}
            </section>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3">
                <h2 className="text-sm font-semibold">{tt('T side')}</h2>
                <p className="text-xs text-muted-foreground">
                  {tt('Plants A') + ' '}<span className="num text-foreground">{b.summary.t.plants.A}</span>, B <span className="num text-foreground">{b.summary.t.plants.B}</span> {tt('in') + ' '}{b.summary.t.tRounds} {tt('rounds')}
                  {b.summary.t.avgPlantT != null && <> {tt('· average plant at') + ' '}<span className="num text-foreground">{clock(b.summary.t.avgPlantT)}</span></>}
                  {' '}{tt('· won after planting') + ' '}<span className="num text-foreground">{p(b.postPlant)}</span> {n(b.postPlant) && `(${n(b.postPlant)})`}
                </p>
                <Trends title={tt('Opening duels at')} items={b.trends.openings} />
                <Trends title={tt('Positions at 20 s')} items={b.trends.setups.t} />
                <div className="break-inside-avoid"><h3 className="mb-1 text-xs font-medium">{tt('Recurring grenades')}</h3><Lineups items={b.lineups.t} /></div>
              </section>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold">{tt('CT side')}</h2>
                <p className="text-xs text-muted-foreground">{tt('Retakes won') + ' '}<span className="num text-foreground">{p(b.retakes)}</span> {n(b.retakes) && `(${n(b.retakes)})`}</p>
                <Trends title={tt('Setup at 20 s')} items={b.trends.setups.ct} />
                <div className="break-inside-avoid"><h3 className="mb-1 text-xs font-medium">{tt('Recurring grenades')}</h3><Lineups items={b.lineups.ct} /></div>
              </section>
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{tt('Players')}</h2>
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">{tt('Player')}</TableHead><TableHead>{tt('Role')}</TableHead>
                  <TableHead className="text-right">{b.players.some((x) => x.agg.rating3 != null) ? '3.0≈' : '2.0≈'}</TableHead>
                  <TableHead className="text-right">{tt('ADR')}</TableHead><TableHead className="text-right">{tt('KAST')}</TableHead>
                  <TableHead className="text-right">{tt('Opening K–D')}</TableHead><TableHead className="text-right">{tt('Share of openings')}</TableHead>
                  <TableHead className="pr-0 text-right">{tt('AWP kills')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {b.players.map((pl) => (
                    <TableRow key={pl.agg.steamid}>
                      <TableCell className="pl-0 font-medium">{pl.agg.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {pl.hints.length ? pl.hints.slice(0, 2).map((h) => <div key={h.role}><span className="text-foreground">{h.role}</span> · {h.evidence}</div>) : '—'}
                      </TableCell>
                      <TableCell className="num text-right">{(pl.agg.rating3 ?? pl.agg.rating2).toFixed(2)}</TableCell>
                      <TableCell className="num text-right">{pl.agg.adr.toFixed(0)}</TableCell>
                      <TableCell className="num text-right">{pl.agg.kast.toFixed(0)}%</TableCell>
                      <TableCell className="num text-right">{pl.agg.entryKills}–{pl.agg.entryDeaths}</TableCell>
                      <TableCell className="num text-right">{pl.openingShare}%</TableCell>
                      <TableCell className="num pr-0 text-right">{pl.awpShare}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <footer className="border-t pt-3 text-[11px] text-muted-foreground">{tt('Made with Celeste from local demos. Roles are hints from AWP kills, opening duels, positions at 20–30 s, flashes and trades.')}</footer>
          </article>
        )}
      </div>
    </div>
  );
}
