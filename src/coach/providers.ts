// Coach IA : trois façons de faire tourner un modèle de langage, au choix de l'utilisateur.
//  - Ollama sur son PC (gratuit, local) ;
//  - WebLLM dans le navigateur (gratuit, local, WebGPU, modèle téléchargé une fois) ;
//  - une API compatible OpenAI avec sa propre clé (Gemini, Groq, OpenRouter, Mistral, OpenAI...).
// Réglages stockés dans ce navigateur. Aucune clé dans le code.

export type ProviderKind = 'ollama' | 'webllm' | 'openai';

export interface CoachSettings {
  kind: ProviderKind;
  ollamaUrl: string;
  ollamaModel: string;
  webllmModel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Taille du contexte demandée à Ollama (par défaut 4096 : le résumé du match y serait tronqué). */
  numCtx: number;
  /** Laisser le modèle chercher les faits lui-même avec des outils (si le modèle le permet). */
  useTools: boolean;
}

export const DEFAULT_SETTINGS: CoachSettings = {
  kind: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3:8b', numCtx: 16384, useTools: true,
  webllmModel: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', model: 'gemini-2.5-flash',
};

/** Fournisseurs compatibles OpenAI proposés (l'utilisateur peut saisir n'importe quelle adresse). */
export const OPENAI_PRESETS: { label: string; baseUrl: string; model: string; note?: string; keyUrl?: string; tools?: boolean }[] = [
  { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', note: 'Free tier with a Google account.', keyUrl: 'https://aistudio.google.com/apikey' },
  // Modèles gratuits via OpenRouter (compte gratuit, sans carte ; nombre de requêtes par jour limité)
  { label: 'DeepSeek (free)', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash:free', note: 'DeepSeek V4 Flash, free through OpenRouter (free account, no card; daily limit on free models).', keyUrl: 'https://openrouter.ai/keys' },
  { label: 'Gemma 3 (free)', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it:free', note: 'Google Gemma 3 27B, free through OpenRouter. It does not call tools: the coach sends the full match summary instead.', keyUrl: 'https://openrouter.ai/keys', tools: false },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
];

export const WEBLLM_MODELS = [
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B (≈2 GB)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (≈2 GB)' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini (≈2.3 GB)' },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 7B (≈5 GB, better)' },
  { id: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma 3 1B (≈0.7 GB, light)' },
  { id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', label: 'DeepSeek R1 Distill 7B (≈5 GB, reasons step by step)' },
];

const KEY = 'scrimview.coach';
/** Modèles Ollama conseillés (ceux qui n'appellent pas d'outils reçoivent le résumé complet du match). */
export const OLLAMA_RECOMMENDED = [
  { id: 'qwen3:8b', note: 'Best balance on an average PC (about 5 GB, 8 GB of VRAM or a recent CPU). Good with tools and in French.' },
  { id: 'qwen3:14b', note: 'Sharper analysis, needs about 10 GB of VRAM.' },
  { id: 'gpt-oss:20b', note: 'Strong reasoning, needs about 14 GB of memory.' },
  { id: 'llama3.1:8b', note: 'Fast and light, weaker reasoning and French.' },
  { id: 'qwen3:4b', note: 'For small machines (about 3 GB). Expect simpler answers.' },
  { id: 'gemma3:12b', note: 'Google Gemma 3 (about 8 GB), good French. It does not call tools in Ollama: the coach sends the full match summary instead.' },
  { id: 'deepseek-r1:8b', note: 'DeepSeek R1 distilled (about 5 GB): reasons step by step, slower. If it cannot call tools, the coach sends the full match summary instead.' },
];

export function loadCoachSettings(): CoachSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_SETTINGS; }
}
export function saveCoachSettings(s: CoachSettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignoré */ } }

/** Ce qui quitte la machine avec ce réglage (affiché à l'utilisateur). */
export function privacyNote(s: CoachSettings): string {
  if (s.kind === 'ollama') return 'Runs on your computer through Ollama: nothing leaves your machine.';
  if (s.kind === 'webllm') return 'Runs in this browser (WebGPU): nothing leaves your machine. The model is downloaded once from Hugging Face.';
  let host = s.baseUrl;
  try { host = new URL(s.baseUrl).host; } catch { /* adresse brute */ }
  return `Sends the computed stats summary (never the demo file) to ${host} with your key.`;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export type OnToken = (text: string) => void;

export class CoachError extends Error {}

type Fetch = typeof fetch;

/** Lit un flux SSE (« data: {...} ») au format OpenAI et renvoie le texte complet. */
async function readSse(res: Response, onToken: OnToken): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const t = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
        if (t) { full += t; onToken(full); }
      } catch { /* ligne incomplète */ }
    }
  }
  return full;
}

/** Lit le flux NDJSON d'Ollama (une ligne JSON par morceau). */
async function readNdjson(res: Response, onToken: OnToken): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const t = j.message?.content ?? '';
        if (t) { full += t; onToken(full); }
      } catch { /* ligne incomplète */ }
    }
  }
  return full;
}

// Moteur WebLLM gardé en mémoire (chargement long la première fois)
let webllm: { id: string; engine: { chat: { completions: { create: (o: unknown) => Promise<AsyncIterable<{ choices: { delta?: { content?: string } }[] }>> } } } } | null = null;

export async function chat(s: CoachSettings, messages: ChatMessage[], onToken: OnToken, onStatus: (t: string) => void = () => {}, f: Fetch = fetch): Promise<string> {
  if (s.kind === 'ollama') {
    let res: Response;
    try {
      res = await f(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: s.ollamaModel, messages, stream: true, think: false, options: { temperature: 0.3, num_ctx: s.numCtx || 16384 } }),
      });
    } catch {
      throw new CoachError(`Ollama is not reachable at ${s.ollamaUrl}. Start Ollama, and allow this site: set OLLAMA_ORIGINS to this page's address (or *) before starting it.`);
    }
    if (res.status === 404) throw new CoachError(`Model “${s.ollamaModel}” not found in Ollama: run “ollama pull ${s.ollamaModel}”.`);
    if (!res.ok) throw new CoachError(`Ollama answered ${res.status}.`);
    return readNdjson(res, onToken);
  }
  if (s.kind === 'openai') {
    if (!s.apiKey) throw new CoachError('Add your API key in the coach settings.');
    let res: Response;
    try {
      res = await f(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ model: s.model, messages, stream: true, temperature: 0.3 }),
      });
    } catch {
      throw new CoachError('Could not reach the provider (network, or it does not accept calls from a browser).');
    }
    if (res.status === 401 || res.status === 403) throw new CoachError('The provider refused the key.');
    if (res.status === 429) throw new CoachError('Rate limit or free quota reached: try again later.');
    if (!res.ok) throw new CoachError(`The provider answered ${res.status}.`);
    return readSse(res, onToken);
  }
  // WebLLM : chargé seulement si l'utilisateur le choisit
  if (!('gpu' in navigator)) throw new CoachError('This browser has no WebGPU: use Chrome or Edge on a recent GPU, or choose Ollama.');
  if (!webllm || webllm.id !== s.webllmModel) {
    onStatus('Loading the in-browser engine…');
    const mod = await import('@mlc-ai/web-llm');
    const engine = await mod.CreateMLCEngine(s.webllmModel, {
      initProgressCallback: (p: { text: string; progress: number }) => onStatus(`Preparing the model: ${Math.round(p.progress * 100)}% · ${p.text}`),
    });
    webllm = { id: s.webllmModel, engine: engine as unknown as NonNullable<typeof webllm>['engine'] };
    onStatus('');
  }
  let full = '';
  const stream = await webllm.engine.chat.completions.create({ messages, stream: true, temperature: 0.3 });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content ?? '';
    if (t) { full += t; onToken(full); }
  }
  return full;
}

/** Liste des modèles installés dans Ollama (pour le réglage). */
export async function ollamaModels(url: string, f: Fetch = fetch): Promise<string[]> {
  const res = await f(`${url.replace(/\/$/, '')}/api/tags`);
  if (!res.ok) throw new CoachError(`Ollama answered ${res.status}.`);
  const j = await res.json() as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}
