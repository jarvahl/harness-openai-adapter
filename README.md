# harness-openai-adapter

Alpha `0.1.0`: a small OpenAI-compatible HTTP adapter for using Pi as the model behind a native n8n AI Agent.

## Run

```sh
npm install
npm run build
npm start
# or, after building:
nix run .
```

Defaults: `HOST=127.0.0.1`, `PORT=8787`.

Pi uses its real configuration and authentication from `~/.pi/agent` (including `auth.json`). Set `PI_AGENT_DIR` to use another Pi configuration directory. The adapter creates a real `AgentSession` through `@earendil-works/pi-coding-agent`; it does not mock the harness.

## n8n

Configure the native OpenAI-compatible Chat Model with:

- Base URL: `http://127.0.0.1:8787/v1`
- Model: one of the IDs returned by `GET /v1/models`, for example `openai-codex/gpt-5.4`

The adapter exposes `/health`, `/v1/models`, and `/v1/chat/completions`. `/v1/models` exposes only configured and authenticated Pi models as `provider/model-id` entries; there is no default alias. Tools are returned to n8n as tool calls; the adapter does not execute them.

## Status

This is an early POC. Streaming currently emits a protocol-correct SSE completion after Pi finishes rather than forwarding every Pi delta. Authentication and security are intentionally out of scope for `0.1.0`.
