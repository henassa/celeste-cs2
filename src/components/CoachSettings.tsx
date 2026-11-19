// Réglages du coach IA : fournisseur (Ollama, WebLLM, API compatible OpenAI), modèle, clé, langue.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { chat, loadCoachSettings, OLLAMA_RECOMMENDED, ollamaModels, OPENAI_PRESETS, privacyNote, saveCoachSettings, WEBLLM_MODELS, type CoachSettings } from '@/coach/providers';
import type { CoachLanguage } from '@/coach/context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { tt } from '@/i18n';

const LANG_KEY = 'scrimview.coachLang';
export function loadCoachLang(): CoachLanguage {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'fr' || v === 'auto') return v; } catch { /* ignoré */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'auto';
}

export function CoachSettingsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [s, setS] = useState<CoachSettings>(loadCoachSettings);
  const [lang, setLang] = useState<CoachLanguage>(loadCoachLang);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text: string }>({ state: 'idle', text: '' });
  const set = <K extends keyof CoachSettings>(k: K, v: CoachSettings[K]) => setS((x) => ({ ...x, [k]: v }));

  const runTest = async () => {
    setTest({ state: 'running', text: '' });
    try {
      const out = await chat(s, [{ role: 'user', content: 'Reply with exactly: OK' }], () => {}, (t) => setTest({ state: 'running', text: t }));
      setTest({ state: 'ok', text: tt('Answered: {0}', [out.trim().slice(0, 60)]) });
    } catch (e) { setTest({ state: 'error', text: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tt('Coach settings')}</DialogTitle>
          <DialogDescription>{tt('Pick where the language model runs. The coach only sees stats computed by Celeste, never the demo file.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <ToggleGroup type="single" variant="outline" size="sm" value={s.kind} onValueChange={(v) => v && set('kind', v as CoachSettings['kind'])} className="w-full">
            <ToggleGroupItem value="ollama" className="flex-1 text-xs">{tt('Ollama (local)')}</ToggleGroupItem>
            <ToggleGroupItem value="webllm" className="flex-1 text-xs">{tt('In browser')}</ToggleGroupItem>
            <ToggleGroupItem value="openai" className="flex-1 text-xs">{tt('Your API key')}</ToggleGroupItem>
          </ToggleGroup>

          {s.kind === 'ollama' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{tt('Install Ollama (free), then') + ' '}<code className="rounded bg-muted px-1">{tt('ollama pull') + ' '}{s.ollamaModel || 'qwen3:8b'}</code>{tt('. Allow this page: start Ollama with') + ' '}<code className="rounded bg-muted px-1">{tt('OLLAMA_ORIGINS=')}{location.origin}</code> {tt('(or') + ' '}<code className="rounded bg-muted px-1">*</code>).</p>
              <div className="space-y-1.5"><Label>{tt('Address')}</Label><Input value={s.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>{tt('Model')}</Label>
                <div className="flex gap-2">
                  <Input value={s.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} list="ollama-models" />
                  <Button size="sm" variant="outline" onClick={async () => { try { setModels(await ollamaModels(s.ollamaUrl)); } catch (e) { setTest({ state: 'error', text: e instanceof Error ? e.message : String(e) }); } }}>{tt('List')}</Button>
                </div>
                <datalist id="ollama-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
                {models.length > 0 && <p className="text-[11px] text-muted-foreground">{tt('Installed:') + ' '}{models.join(', ')}</p>}
                <div className="flex flex-wrap gap-1 pt-1">
                  {OLLAMA_RECOMMENDED.map((r) => (
                    <Button key={r.id} size="xs" variant={s.ollamaModel === r.id ? 'secondary' : 'outline'} onClick={() => set('ollamaModel', r.id)} title={r.note}>{r.id}</Button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{OLLAMA_RECOMMENDED.find((r) => r.id === s.ollamaModel)?.note ?? tt('Pick a model that supports tools (qwen3, qwen2.5, llama3.1, mistral-small, gpt-oss) so the coach can look up the data itself.')}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{tt('Context size')}</Label>
                <ToggleGroup type="single" variant="outline" size="sm" value={String(s.numCtx)} onValueChange={(v) => v && set('numCtx', Number(v))}>
                  {[8192, 16384, 32768].map((n) => <ToggleGroupItem key={n} value={String(n)} className="px-3 text-xs">{n / 1024}k</ToggleGroupItem>)}
                </ToggleGroup>
                <p className="text-[11px] text-muted-foreground">{tt('Ollama defaults to 4k tokens and silently cuts longer prompts, which made the coach miss most of the match. 16k fits a full match; 32k needs more memory.')}</p>
              </div>
            </div>
          )}

          {s.kind === 'webllm' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{tt('Runs on your GPU through WebGPU (Chrome or Edge). The model is downloaded once (2 to 5 GB) and cached by the browser. Slower and less sharp than Ollama with an 8B model.')}</p>
              <div className="space-y-1.5">
                <Label>{tt('Model')}</Label>
                <Select value={s.webllmModel} onValueChange={(v) => set('webllmModel', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{WEBLLM_MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {s.kind === 'openai' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {OPENAI_PRESETS.map((p) => (
                  <Button key={p.label} size="xs" variant={s.baseUrl === p.baseUrl && s.model === p.model ? 'secondary' : 'outline'} onClick={() => setS((x) => ({ ...x, baseUrl: p.baseUrl, model: p.model, useTools: p.tools ?? x.useTools }))}>{p.label}</Button>
                ))}
              </div>
              {(() => {
                const p = OPENAI_PRESETS.find((x) => x.baseUrl === s.baseUrl && x.model === s.model);
                return (
                  <p className="text-xs text-muted-foreground">
                    {p?.note ?? tt('Free options: DeepSeek and Gemma 3 through OpenRouter, Google Gemini, Groq. Any OpenAI-compatible endpoint works.')}
                    {p?.keyUrl && <> <a className="underline hover:text-foreground" href={p.keyUrl} target="_blank" rel="noreferrer">{tt('Get a key')}</a>.</>}
                  </p>
                );
              })()}
              <div className="space-y-1.5"><Label>{tt('Endpoint')}</Label><Input value={s.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{tt('Model')}</Label><Input value={s.model} onChange={(e) => set('model', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{tt('API key')}</Label><Input type="password" value={s.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={tt('Stored in this browser only')} /></div>
            </div>
          )}

          {s.kind !== 'webllm' && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 accent-foreground" checked={s.useTools} onChange={(e) => set('useTools', e.target.checked)} />
              <span><span className="font-medium">{tt('Let the coach look up the data')}</span><span className="block text-muted-foreground">{tt('The model calls local tools (rounds, players, teams, utility, library) before answering. Sharper answers; falls back to a full summary if the model cannot use tools.')}</span></span>
            </label>
          )}
          <div className="space-y-1.5">
            <Label>{tt('Answers in')}</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={lang} onValueChange={(v) => v && setLang(v as CoachLanguage)}>
              <ToggleGroupItem value="fr" className="px-3 text-xs">{tt('Français')}</ToggleGroupItem>
              <ToggleGroupItem value="en" className="px-3 text-xs">{tt('English')}</ToggleGroupItem>
              <ToggleGroupItem value="auto" className="px-3 text-xs">{tt('Same as my question')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">{privacyNote(s)}</p>
          {test.state !== 'idle' && (
            <p className={test.state === 'error' ? 'text-xs text-destructive' : 'flex items-center gap-2 text-xs text-muted-foreground'}>
              {test.state === 'running' && <Loader2 className="size-3.5 animate-spin" />}{test.text || (test.state === 'running' ? tt('Testing…') : '')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={runTest} disabled={test.state === 'running'}>{tt('Test')}</Button>
          <Button onClick={() => { saveCoachSettings(s); try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignoré */ } onSaved(); onOpenChange(false); }}>{tt('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
