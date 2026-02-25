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

## Local config template (with MCP examples)

Пример с несколькими MCP-серверами (stdio + http transport) вынесен в `config.local.json.template`.

```bash
cp config.local.json.template config.local.json
```

В template уже есть примеры:
- `@modelcontextprotocol/server-filesystem` (stdio)
- `@modelcontextprotocol/server-github` (stdio)
- `deepwiki-http` (http transport, disabled по умолчанию)

> В реальном окружении храните секреты в переменных окружения/secret manager, а не в файле конфига.

## Run via Docker Compose

1. Create local env file:

```bash
cp .env.local.template .env.local
```

2. Fill `.env.local` (at minimum `OPENAI_API_KEY`).

3. (Опционально) использовать локальный конфиг-шаблон:

```bash
cp config.local.json.template config.local.json
```

Если хотите запускаться именно с ним в Docker, замените volume в `docker-compose.yml` на
`./config.local.json:/app/config.local.json:ro` и выставьте `CONFIG_PATH=/app/config.local.json` в `.env.local`.

4. First run with build:

```bash
docker compose up --build
```

5. Next runs:

```bash
docker compose up
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
