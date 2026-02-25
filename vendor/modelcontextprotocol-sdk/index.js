import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class StdioClientTransport {
  constructor({ command, args = [], env = {} }) {
    this.proc = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    this.nextId = 1;
    this.pending = new Map();
    let buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (!msg.id || !this.pending.has(msg.id)) continue;
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  async request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return p;
  }
}

export class StreamableHTTPClientTransport {
  constructor(url, { requestInit } = {}) {
    this.url = url;
    this.requestInit = requestInit ?? {};
    this.sessionId = undefined;
  }

  async request(method, params) {
    const headers = { 'content-type': 'application/json', ...(this.requestInit.headers ?? {}) };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const resp = await fetch(this.url, {
      ...this.requestInit,
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    });
    const sid = resp.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;
    const json = await resp.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  }
}

export class Client {
  constructor(info = { name: 'client', version: '0.0.0' }) {
    this.info = info;
    this.transport = null;
    this.initialized = false;
  }

  async connect(transport) {
    this.transport = transport;
    await this.#initialize();
  }

  async #initialize() {
    if (this.initialized) return;
    if (!this.transport) throw new Error('transport is not connected');
    await this.transport.request('initialize', { clientInfo: this.info });
    this.initialized = true;
  }

  async listTools() {
    await this.#initialize();
    return this.transport.request('tools/list');
  }

  async callTool({ name, arguments: args }) {
    await this.#initialize();
    return this.transport.request('tools/call', { name, arguments: args });
  }
}
