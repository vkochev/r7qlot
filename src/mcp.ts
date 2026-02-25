import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

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

type ConnectedClient = { name: string; client: any; ready: Promise<void> };

function connectClient(cfg: McpServerConfig): ConnectedClient {
  const client = new Client({ name: 'mvp-agent', version: '0.1.0' });
  const ready = (async () => {
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error(`stdio server ${cfg.name} missing command`);
      await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} }));
      return;
    }
    if (!cfg.url) throw new Error(`http server ${cfg.name} missing url`);
    await client.connect(new StreamableHTTPClientTransport(cfg.url, { requestInit: { headers: cfg.headers ?? {} } }));
  })();
  return { name: cfg.name, client, ready };
}

export class McpManager {
  private clients: ConnectedClient[];

  constructor(configs: McpServerConfig[]) {
    this.clients = (configs ?? []).filter((c) => c.enabled !== false).map(connectClient);
  }

  async listTools(): Promise<Tool[]> {
    const all = await Promise.all(
      this.clients.map(async ({ name, client, ready }) => {
        await ready;
        const result: any = await client.listTools();
        return (result.tools ?? []).map((t: any) => ({ ...t, _serverName: name }));
      }),
    );
    return all.flat();
  }

  async callTool(serverName: string, name: string, args: unknown): Promise<unknown> {
    const item = this.clients.find((c) => c.name === serverName);
    if (!item) throw new Error(`tool server not found: ${serverName}`);
    await item.ready;
    return item.client.callTool({ name, arguments: args });
  }
}
