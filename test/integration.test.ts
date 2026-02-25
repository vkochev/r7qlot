import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';

function listen(server: any): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const listener = server.listen(0, '127.0.0.1', () => resolve({
      port: (listener.address() as any).port,
      close: () => new Promise((r) => listener.close(() => r(null))),
    }));
  });
}

test('MVP endpoints and react loop with streaming', async () => {
  let toolCalled = false;
  let mcpInitialized = false;

  const mcpServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const ch of req) body += ch.toString();
    const rpc = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    res.setHeader('Mcp-Session-Id', req.headers['mcp-session-id']?.toString() || 'sess-1');
    if (rpc.method === 'initialize') {
      mcpInitialized = true;
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { serverInfo: { name: 'mock' } } }));
      return;
    }
    if (rpc.method === 'tools/list') {
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { tools: [{ name: 'sum', description: 'sum two numbers', inputSchema: { type: 'object' } }] },
        }),
      );
      return;
    }
    if (rpc.method === 'tools/call') {
      toolCalled = true;
      const { a, b } = rpc.params.arguments;
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { value: a + b } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const upstreamServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const ch of req) body += ch.toString();
    const payload = JSON.parse(body);
    const hasTool = payload.messages.some((m: any) => m.role === 'tool');
    res.setHeader('content-type', 'application/json');
    if (!hasTool) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'sum', arguments: JSON.stringify({ a: 2, b: 3 }) },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }
    const toolMsg = payload.messages.findLast((m: any) => m.role === 'tool');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Ответ: ${toolMsg.content}` } }] }));
  });

  const mcp = await listen(mcpServer);
  const upstream = await listen(upstreamServer);
  process.env.UPSTREAM_KEY = 'k';

  const app = createApp({
    public_model_id: 'agent-public',
    upstream: { base_url: `http://127.0.0.1:${upstream.port}`, api_key_env: 'UPSTREAM_KEY', model: 'gpt-upstream' },
    mcp: [{ name: 'm1', transport: 'http', url: `http://127.0.0.1:${mcp.port}`, enabled: true }],
    agent: {
      max_steps: 4,
      request_timeout_ms: 5000,
      max_tool_output_bytes: 1024,
      status_tags_enabled: true,
    },
  });
  const appListener = await listen(app);

  const health = await fetch(`http://127.0.0.1:${appListener.port}/healthz`);
  assert.equal(health.status, 200);

  const models = await fetch(`http://127.0.0.1:${appListener.port}/v1/models`);
  const modelsJson: any = await models.json();
  assert.equal(modelsJson.data[0].id, 'agent-public');

  const nonStreamResp = await fetch(`http://127.0.0.1:${appListener.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'agent-public', stream: false, messages: [{ role: 'user', content: '2+3' }] }),
  });
  const nonStreamJson: any = await nonStreamResp.json();
  assert.match(nonStreamJson.choices[0].message.content, /Ответ:/);

  const streamResp = await fetch(`http://127.0.0.1:${appListener.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'agent-public', stream: true, messages: [{ role: 'user', content: '2+3' }] }),
  });
  const sseText = await streamResp.text();
  assert.match(sseText, /\[STATUS\]Планирую шаги\[\/STATUS\]/);
  assert.match(sseText, /\[STATUS\]Вызываю tool: sum\[\/STATUS\]/);
  assert.match(sseText, /data: \[DONE\]/);
  assert.equal(toolCalled, true);
  assert.equal(mcpInitialized, true);

  await Promise.all([
    appListener.close(),
    mcp.close(),
    upstream.close(),
  ]);
});
