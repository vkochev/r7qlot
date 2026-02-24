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
