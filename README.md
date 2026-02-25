# MVP headless AI agent (OpenAI-compatible)

Server reads `config.json` (or `CONFIG_PATH`) and exposes:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`

Streaming mode (`stream=true`) uses SSE with OpenAI-style chunk payloads and final `data: [DONE]`.

## Local run (node)

```bash
npm install
npm run build
npm start
```

## Run via Docker Compose

1. Create local env file:

```bash
cp .env.local.template .env.local
```

2. Fill `.env.local` (at minimum `OPENAI_API_KEY`).

3. First run with build:

```bash
docker-compose up --build
```

4. Next runs:

```bash
docker-compose up
```

## Smoke-check after compose startup

```bash
source .env.local
curl -sS "http://localhost:${PORT}/healthz"
curl -sS "http://localhost:${PORT}/v1/models"
curl -N -sS "http://localhost:${PORT}/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"model":"agent-mvp","stream":true,"messages":[{"role":"user","content":"Привет"}]}'
```

For streaming request, ensure output contains `data: [DONE]`.
