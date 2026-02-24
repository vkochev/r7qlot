import { randomUUID } from 'node:crypto';

export class StreamableHTTPClientTransport {
  constructor(url, { requestInit } = {}) {
    this.url = url;
    this.requestInit = requestInit ?? {};
    this.sessionId = undefined;
  }

  async request(method, params) {
    const headers = {
      'content-type': 'application/json',
      ...(this.requestInit.headers ?? {}),
    };
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
