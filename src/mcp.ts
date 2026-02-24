import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/transports/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/transports/streamableHttp.js';

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

class McpSdkClient {
  private client: Client;
  private connected = false;

  constructor(private cfg: McpServerConfig) {
    this.client = new Client({ name: 'mvp-agent', version: '0.1.0' });
  }

  private async connectIfNeeded() {
    if (this.connected) return;
    if (this.cfg.transport === 'stdio') {
      if (!this.cfg.command) throw new Error(`stdio server ${this.cfg.name} missing command`);
      await this.client.connect(
        new StdioClientTransport({ command: this.cfg.command, args: this.cfg.args ?? [], env: this.cfg.env ?? {} }),
      );
    } else {
      if (!this.cfg.url) throw new Error(`http server ${this.cfg.name} missing url`);
      await this.client.connect(
        new StreamableHTTPClientTransport(this.cfg.url, { requestInit: { headers: this.cfg.headers ?? {} } }),
      );
    }
    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    await this.connectIfNeeded();
    const result: any = await this.client.listTools();
    return (result.tools ?? []).map((t: any) => ({ ...t, _serverName: this.cfg.name }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    await this.connectIfNeeded();
    const result: any = await this.client.callTool({ name, arguments: args });
    return result;
  }
}

export class McpManager {
  private clients: Array<{ name: string; client: McpSdkClient }>;

  constructor(configs: McpServerConfig[]) {
    this.clients = (configs ?? [])
      .filter((c) => c.enabled !== false)
      .map((c) => ({ name: c.name, client: new McpSdkClient(c) }));
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
