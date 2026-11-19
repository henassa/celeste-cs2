// Agent du coach : boucle d'appels d'outils avec des réponses simulées (Ollama et OpenAI).
import { describe, expect, it } from 'vitest';
import { askCoach } from '../src/coach/agent';
import type { CoachSettings } from '../src/coach/providers';
import type { ToolDef } from '../src/coach/tools';

const enc = new TextEncoder();
const stream = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200 });

const base: CoachSettings = { kind: 'ollama', ollamaUrl: 'http://x', ollamaModel: 'qwen3:8b', webllmModel: '', baseUrl: 'http://api', apiKey: 'k', model: 'm', numCtx: 16384, useTools: true };
const calls: string[] = [];
const tools: ToolDef[] = [{ name: 'round_detail', description: 'd', parameters: { type: 'object', properties: { round: { type: 'integer', description: 'r' } } }, run: (a) => { calls.push(`round_detail ${a.round}`); return 'R5: B site retake failed'; } }];

describe('coach agent', () => {
  it('Ollama : appelle un outil puis répond, avec num_ctx', async () => {
    calls.length = 0;
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      if (bodies.length === 1) return stream([JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'round_detail', arguments: { round: 5 } } }] } }) + '\n', JSON.stringify({ done: true }) + '\n']);
      return stream([JSON.stringify({ message: { content: 'Lost R5 on the ' } }) + '\n', JSON.stringify({ message: { content: 'retake.' } }) + '\n']);
    }) as typeof fetch;
    const used: string[] = [];
    const out = await askCoach(base, 'sys', [], 'why R5?', tools, () => 'FULL', { onToken: () => {}, onTool: (n) => used.push(n) }, f);
    expect(out).toBe('Lost R5 on the retake.');
    expect(calls).toEqual(['round_detail 5']);
    expect(used).toEqual(['round_detail']);
    expect(bodies[0].options.num_ctx).toBe(16384);
    expect(bodies[0].tools[0].function.name).toBe('round_detail');
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_name: 'round_detail', content: 'R5: B site retake failed' });
  });

  it('OpenAI : arguments en morceaux et tool_call_id', async () => {
    calls.length = 0;
    const bodies: any[] = [];
    const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) return stream([
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'round_detail', arguments: '{"rou' } }] } }] }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'nd":5}' } }] } }] }), 'data: [DONE]\n\n']);
      return stream([sse({ choices: [{ delta: { content: 'Done.' } }] }), 'data: [DONE]\n\n']);
    }) as typeof fetch;
    const out = await askCoach({ ...base, kind: 'openai' }, 'sys', [], 'q', tools, () => 'FULL', { onToken: () => {} }, f);
    expect(out).toBe('Done.');
    expect(calls).toEqual(['round_detail 5']);
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(bodies[1].messages.at(-2).tool_calls[0].function.arguments).toBe('{"round":5}');
  });

  it('repli sur le contexte complet si le modèle ne gère pas les outils', async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      if (body.tools) return new Response('{"error":"llama2 does not support tools"}', { status: 400 });
      return stream([JSON.stringify({ message: { content: 'ok' } }) + '\n']);
    }) as typeof fetch;
    const out = await askCoach(base, 'sys', [], 'q', tools, () => 'FULL CONTEXT', { onToken: () => {} }, f);
    expect(out).toBe('ok');
    expect(bodies[1].messages[0].content).toContain('FULL CONTEXT');
    expect(bodies[1].options.num_ctx).toBe(16384);
  });
});
