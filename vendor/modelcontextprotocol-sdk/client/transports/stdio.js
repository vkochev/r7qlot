import { spawn } from 'node:child_process';

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
