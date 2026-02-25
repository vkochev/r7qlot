import { Client } from '@modelcontextprotocol/sdk/client';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

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

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _serverName: string;
};

type McpClient = InstanceType<typeof Client>;
type ConnectedClient = { name: string; client: McpClient; ready: Promise<void> };

function connectClient(cfg: McpServerConfig): ConnectedClient {
  const client = new Client({ name: 'mvp-agent', version: '0.1.0' });
  const ready = (async () => {
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error(`stdio server ${cfg.name} missing command`);
      await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} }));
      return;
    }
    if (!cfg.url) throw new Error(`http server ${cfg.name} missing url`);
    await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } }));
  })();
  return { name: cfg.name, client, ready };
}

export class McpManager {
  private clients: ConnectedClient[];

  constructor(configs: McpServerConfig[]) {
    this.clients = (configs ?? []).filter((c) => c.enabled !== false).map(connectClient);
  }

  async listTools(options?: RequestOptions): Promise<Tool[]> {
    const all = await Promise.all(
      this.clients.map(async ({ name, client, ready }) => {
        await ready;
        const result: ListToolsResult = await client.listTools(undefined, options);
        return (result.tools ?? []).map((t) => ({ ...t, _serverName: name }));
      }),
    );
    return all.flat();
  }

  async callTool(serverName: string, name: string, args: unknown, options?: RequestOptions): Promise<CallToolResult> {
    const item = this.clients.find((c) => c.name === serverName);
    if (!item) throw new Error(`tool server not found: ${serverName}`);
    await item.ready;
    return item.client.callTool({ name, arguments: args }, undefined, options);
  }
}
