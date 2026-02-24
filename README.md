# MVP headless AI agent (OpenAI-compatible)

## Run

```bash
npm install
npm start
```

Server reads `config.json` (or `CONFIG_PATH`) and exposes:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`

Streaming mode (`stream=true`) uses SSE with OpenAI-style chunk payloads and final `data: [DONE]`.


You can provide secrets via `.env` (loaded by `dotenv`) and reference them in config with `{env:VAR}`.
