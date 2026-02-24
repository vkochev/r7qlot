declare module 'node:http' {
  const x: any;
  export default x;
}
declare module 'node:fs' {
  export const readFileSync: any;
}
declare module 'node:test' {
  const test: any;
  export default test;
}
declare module 'node:assert/strict' {
  const x: any;
  export default x;
}
declare module '@modelcontextprotocol/sdk/client/index.js' {
  export class Client {
    constructor(info?: any);
    connect(transport: any): Promise<void>;
    listTools(): Promise<any>;
    callTool(input: any): Promise<any>;
  }
}
declare module '@modelcontextprotocol/sdk/client/transports/stdio.js' {
  export class StdioClientTransport {
    constructor(cfg: any);
  }
}
declare module '@modelcontextprotocol/sdk/client/transports/streamableHttp.js' {
  export class StreamableHTTPClientTransport {
    constructor(url: string, opts?: any);
  }
}
declare var process: any;
declare var Buffer: any;
