import http from 'node:http';
import { readFileSync } from 'node:fs';
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

async function readBody(req: any) {
  let data = '';
  for await (const chunk of req) data += chunk.toString('utf8');
  return data ? JSON.parse(data) : {};
}

export function createServer(config: Config) {
  const mcp = new McpManager(config.mcp ?? []);
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: config.public_model_id, object: 'model' }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const body = await readBody(req);
        const model = body.model || config.public_model_id;
        const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
        const stream = !!body.stream;
        if (stream) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: final }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err: any) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message ?? String(err) }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  const port = Number(process.env.PORT ?? 3000);
  createServer(config).listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
}
