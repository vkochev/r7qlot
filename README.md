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


## Example `config.json`

Ниже пример заполненного конфига с общеизвестными MCP-серверами (значения ключей/токенов — mock):

```json
{
  "public_model_id": "agent-mvp",
  "upstream": {
    "base_url": "https://api.openai.com/v1",
    "api_key_env": "OPENAI_API_KEY",
    "model": "gpt-4o-mini",
    "timeout_ms": 30000
  },
  "mcp": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "enabled": true
    },
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_mock_example_token_1234567890"
      },
      "enabled": true
    }
  ],
  "agent": {
    "max_steps": 8,
    "request_timeout_ms": 60000,
    "max_tool_output_bytes": 65536,
    "tool_policy": {
      "allowlist": [],
      "denylist": []
    },
    "status_tags_enabled": true,
    "repeat_tool_call_limit": 3
  }
}
```

> В реальном окружении храните секреты в переменных окружения/секрет-хранилище, а не прямо в `config.json`.

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
