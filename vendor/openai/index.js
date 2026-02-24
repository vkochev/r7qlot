class ChatCompletionsResource {
  constructor(client) {
    this.client = client;
  }

  async create(payload, requestOptions = {}) {
    const signal = requestOptions.signal;
    const resp = await fetch(`${this.client.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.client.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok) throw new Error(`openai upstream error: ${resp.status}`);
    return resp.json();
  }
}

export default class OpenAI {
  constructor({ apiKey, baseURL }) {
    this.apiKey = apiKey;
    this.baseURL = (baseURL || '').replace(/\/$/, '');
    this.chat = { completions: new ChatCompletionsResource(this) };
  }
}
