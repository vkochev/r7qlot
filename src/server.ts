import { readFileSync } from 'node:fs';
import express from 'express';
import { runAgent } from './agent.js';
import { McpManager, McpServerConfig } from './mcp.js';

type Config = {
  public_model_id: string;
  upstream: { base_url: string; api_key_env: string; model: string; timeout_ms?: number };
  mcp: McpServerConfig[];
  agent: {
    max_steps: number;
    request_timeout_ms: number;
    max_tool_output_bytes: number;
    tool_policy?: { allowlist?: string[]; denylist?: string[] };
    status_tags_enabled?: boolean;
  };
};

function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\{env:([A-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? '');
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as any).map(([k, v]) => [k, resolveEnvVars(v)]));
  return value;
}

function readConfig(): Config {
  const path = process.env.CONFIG_PATH ?? 'config.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Config;
  return resolveEnvVars(raw) as Config;
}

function sseChunk(id: string, model: string, content?: string, finish: null | 'stop' = null) {
  return { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: content !== undefined ? { content } : {}, finish_reason: finish }] };
}

export function createApp(config: Config) {
  const app = express();
  app.use(express.json());
  const mcp = new McpManager(config.mcp ?? []);

  app.get('/healthz', (_req: any, res: any) => res.status(200).json({ ok: true }));

  app.get('/v1/models', (_req: any, res: any) => {
    res.status(200).json({ object: 'list', data: [{ id: config.public_model_id, object: 'model' }] });
  });

  app.post('/v1/chat/completions', async (req: any, res: any) => {
    try {
      const body = req.body ?? {};
      const model = body.model || config.public_model_id;
      const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
      const stream = !!body.stream;
      if (stream) {
        res.set('content-type', 'text/event-stream');
        res.set('cache-control', 'no-cache');
        res.set('connection', 'keep-alive');
      }
      const final = await runAgent({
        messages: body.messages ?? [],
        mcp,
        agent: config.agent,
        upstream: { base_url: config.upstream.base_url, model: config.upstream.model, api_key: process.env[config.upstream.api_key_env] ?? '', timeout_ms: config.upstream.timeout_ms },
        onChunk: (txt) => {
          if (stream) res.write(`data: ${JSON.stringify(sseChunk(id, model, txt, null))}\n\n`);
        },
      });
      if (stream) {
        res.write(`data: ${JSON.stringify(sseChunk(id, model, undefined, 'stop'))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(200).json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: final }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? String(err) });
    }
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  const port = Number(process.env.PORT ?? 3000);
  createApp(config).listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
}
