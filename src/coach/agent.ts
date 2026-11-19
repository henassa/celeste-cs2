// Agent du coach : le modèle appelle les outils (rounds, joueurs, équipes, bibliothèque) pour
// rassembler les faits, puis rédige sa réponse. Si le modèle ne gère pas les outils, repli sur
// un contexte complet envoyé d'un coup.

import { chat, CoachError, type ChatMessage, type CoachSettings, type OnToken } from './providers';
import type { ToolDef } from './tools';

type Fetch = typeof fetch;

export interface AgentEvents {
  onToken: OnToken;
  onStatus?: (t: string) => void;
  /** Un outil vient d'être appelé (affiché dans le fil : transparence). */
  onTool?: (name: string, args: Record<string, unknown>) => void;
}

const MAX_STEPS = 8;
/** Les résultats d'outils trop longs sont coupés pour ne pas noyer le contexte. */
const MAX_TOOL_CHARS = 6000;

interface ToolCall { id?: string; name: string; args: Record<string, unknown> }

const schema = (tools: ToolDef[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

function runTool(tools: ToolDef[], call: ToolCall): string {
  const t = tools.find((x) => x.name === call.name);
  if (!t) return `Unknown tool ${call.name}. Available: ${tools.map((x) => x.name).join(', ')}.`;
  try {
    const out = t.run(call.args ?? {});
    return out.length > MAX_TOOL_CHARS ? `${out.slice(0, MAX_TOOL_CHARS)}\n[truncated]` : out;
  } catch (e) { return `Tool error: ${e instanceof Error ? e.message : String(e)}`; }
}

const parseArgs = (a: unknown): Record<string, unknown> => {
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  try { return JSON.parse(String(a || '{}')); } catch { return {}; }
};

/** Une étape Ollama en flux : texte au fil de l'eau, appels d'outils rassemblés. */
async function ollamaStep(s: CoachSettings, messages: unknown[], tools: ToolDef[], onToken: OnToken, f: Fetch): Promise<{ content: string; calls: ToolCall[]; raw: unknown[] }> {
  let res: Response;
  try {
    res = await f(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.ollamaModel, messages, tools: schema(tools), stream: true, think: false, options: { temperature: 0.2, num_ctx: s.numCtx || 16384 } }),
    });
  } catch {
    throw new CoachError(`Ollama is not reachable at ${s.ollamaUrl}. Start Ollama, and allow this site: set OLLAMA_ORIGINS to this page's address (or *) before starting it.`);
  }
  if (res.status === 400) {
    const text = await res.text();
    if (/tool/i.test(text)) throw new NoToolsError();
    throw new CoachError(`Ollama: ${text.slice(0, 200)}`);
  }
  if (res.status === 404) throw new CoachError(`Model “${s.ollamaModel}” not found in Ollama: run “ollama pull ${s.ollamaModel}”.`);
  if (!res.ok) throw new CoachError(`Ollama answered ${res.status}.`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const calls: ToolCall[] = [], raw: unknown[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let j: { message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } };
      try { j = JSON.parse(line); } catch { continue; }
      const t = j.message?.content ?? '';
      if (t) { content += t; onToken(content); }
      for (const c of j.message?.tool_calls ?? []) { raw.push(c); calls.push({ name: c.function.name, args: parseArgs(c.function.arguments) }); }
    }
  }
  return { content, calls, raw };
}

/** Une étape OpenAI-compatible en flux : les arguments des outils arrivent en morceaux. */
async function openaiStep(s: CoachSettings, messages: unknown[], tools: ToolDef[], onToken: OnToken, f: Fetch): Promise<{ content: string; calls: ToolCall[]; raw: unknown[] }> {
  if (!s.apiKey) throw new CoachError('Add your API key in the coach settings.');
  let res: Response;
  try {
    res = await f(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({ model: s.model, messages, tools: schema(tools), stream: true, temperature: 0.2 }),
    });
  } catch { throw new CoachError('Could not reach the provider (network, or it does not accept calls from a browser).'); }
  if (res.status === 400) { const text = await res.text(); if (/tool|function/i.test(text)) throw new NoToolsError(); throw new CoachError(`Provider: ${text.slice(0, 200)}`); }
  if (res.status === 401 || res.status === 403) throw new CoachError('The provider refused the key.');
  if (res.status === 429) throw new CoachError('Rate limit or free quota reached: try again later.');
  if (!res.ok) throw new CoachError(`The provider answered ${res.status}.`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const acc = new Map<number, { id: string; name: string; args: string }>();
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') break outer;
      let j: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
      try { j = JSON.parse(data); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (d?.content) { content += d.content; onToken(content); }
      for (const tc of d?.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }
  }
  const calls = [...acc.values()].map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.args) }));
  const raw = [...acc.values()].map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }));
  return { content, calls, raw };
}

class NoToolsError extends Error {}

/**
 * Pose une question au coach. `fallbackContext` est envoyé en entier si le modèle ne sait pas
 * appeler d'outils (ou si l'utilisateur a désactivé les outils).
 */
export async function askCoach(s: CoachSettings, system: string, history: ChatMessage[], question: string, tools: ToolDef[], fallbackContext: () => string, ev: AgentEvents, f: Fetch = fetch): Promise<string> {
  const plain = () => chat(s, [{ role: 'system', content: `${system}\n\n--- DATA ---\n${fallbackContext()}` }, ...history.slice(-6), { role: 'user', content: question }], ev.onToken, ev.onStatus, f);
  if (!s.useTools || s.kind === 'webllm' || !tools.length) return plain();
  const messages: unknown[] = [
    { role: 'system', content: `${system}\nUse the tools to fetch the facts you need before answering (start with an overview, then drill into rounds, players or teams). Never guess a number you could look up. When the question is about positions (strong spots, setups, where to play), call position_strength, then show_on_map so the zones appear on the user's map.` },
    ...history.slice(-6),
    { role: 'user', content: question },
  ];
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const out = s.kind === 'ollama' ? await ollamaStep(s, messages, tools, ev.onToken, f) : await openaiStep(s, messages, tools, ev.onToken, f);
      if (!out.calls.length) return out.content;
      messages.push(s.kind === 'ollama' ? { role: 'assistant', content: out.content, tool_calls: out.raw } : { role: 'assistant', content: out.content || null, tool_calls: out.raw });
      for (const [i, call] of out.calls.entries()) {
        ev.onTool?.(call.name, call.args);
        ev.onStatus?.(`Looking at ${call.name.replace(/_/g, ' ')}…`);
        const result = runTool(tools, call);
        messages.push(s.kind === 'ollama' ? { role: 'tool', content: result, tool_name: call.name } : { role: 'tool', tool_call_id: call.id || `call_${step}_${i}`, content: result });
      }
      ev.onToken('');
    }
    // Trop d'étapes : on demande la réponse finale sans outils
    messages.push({ role: 'user', content: 'Now write your final answer from the facts gathered.' });
    const final = s.kind === 'ollama' ? await ollamaStep(s, messages, [], ev.onToken, f) : await openaiStep(s, messages, [], ev.onToken, f);
    return final.content;
  } catch (e) {
    if (e instanceof NoToolsError) { ev.onStatus?.('This model cannot use tools: sending the full summary instead.'); return plain(); }
    throw e;
  }
}
