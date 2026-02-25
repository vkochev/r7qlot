declare module 'node:http' {
  export type Server = any;
  export function createServer(...args: any[]): Server;
  const http: {
    createServer: typeof createServer;
  };
  export default http;
}
declare module 'node:fs' {
  export const readFileSync: any;
}
declare module 'node:module' {
  export const createRequire: any;
}
declare module 'node:test' {
  const test: any;
  export default test;
}
declare module 'node:assert/strict' {
  const x: any;
  export default x;
}
declare module 'express' {
  const express: any;
  export default express;
}
declare module '@modelcontextprotocol/sdk/client' {
  export const Client: any;
}
declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export const StdioClientTransport: any;
}
declare module '@modelcontextprotocol/sdk/client/streamableHttp.js' {
  export const StreamableHTTPClientTransport: any;
}
declare var process: any;
declare var Buffer: any;
