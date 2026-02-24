import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type McpServerConfig = {
  name: string;
  transport: 'stdio' | 'http';
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

export type Tool = { name: string; description?: string; inputSchema?: unknown; _serverName: string };

type RpcClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<Tool[]>;
  callTool: (name: string, args: unknown) => Promise<unknown>;
};

class StdioRpcClient implements RpcClient {
  private proc: ChildProcessWithoutNullStreams;
  private initialized = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  constructor(private cfg: McpServerConfig) {
    if (!cfg.command) throw new Error(`stdio server ${cfg.name} missing command`);
    this.proc = spawn(cfg.command, cfg.args ?? [], {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
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
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
          else pending.resolve(msg.result);
        }
      }
    });
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    return p;
  }

  async initialize() {
    if (this.initialized) return;
    await this.rpc('initialize', { clientInfo: { name: 'mvp-agent', version: '0.1.0' } });
    this.initialized = true;
  }

  async listTools(): Promise<Tool[]> {
    await this.initialize();
    const res = await this.rpc('tools/list');
    return (res.tools ?? []).map((t: any) => ({ ...t, _serverName: this.cfg.name }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    await this.initialize();
    return this.rpc('tools/call', { name, arguments: args });
  }
}

class HttpRpcClient implements RpcClient {
  private initialized = false;
  private sessionId?: string;

  constructor(private cfg: McpServerConfig) {
    if (!cfg.url) throw new Error(`http server ${cfg.name} missing url`);
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(this.cfg.headers ?? {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const body = { jsonrpc: '2.0', id: randomUUID(), method, params };
    const resp = await fetch(this.cfg.url!, { method: 'POST', headers, body: JSON.stringify(body) });
    const session = resp.headers.get('Mcp-Session-Id');
    if (session) this.sessionId = session;
    const json = await resp.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.result;
  }

  async initialize() {
    if (this.initialized) return;
    await this.rpc('initialize', { clientInfo: { name: 'mvp-agent', version: '0.1.0' } });
    this.initialized = true;
  }

  async listTools(): Promise<Tool[]> {
    await this.initialize();
    const res = await this.rpc('tools/list');
    return (res.tools ?? []).map((t: any) => ({ ...t, _serverName: this.cfg.name }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    await this.initialize();
    return this.rpc('tools/call', { name, arguments: args });
  }
}

export class McpManager {
  private clients: Array<{ name: string; client: RpcClient }>;

  constructor(configs: McpServerConfig[]) {
    this.clients = (configs ?? [])
      .filter((c) => c.enabled !== false)
      .map((c) => ({
        name: c.name,
        client: c.transport === 'stdio' ? new StdioRpcClient(c) : new HttpRpcClient(c),
      }));
  }

  async listTools(): Promise<Tool[]> {
    const chunks = await Promise.all(this.clients.map((c) => c.client.listTools()));
    return chunks.flat();
  }

  async callTool(serverName: string, name: string, args: unknown): Promise<unknown> {
    const item = this.clients.find((c) => c.name === serverName);
    if (!item) throw new Error(`tool server not found: ${serverName}`);
    return item.client.callTool(name, args);
  }
}
