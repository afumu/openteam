# ACP Support Design

## Goal

Let OpenTeam route work from web AI roles to a local ACP-capable coding or office agent without granting arbitrary web pages direct access to the user's local machine.

## Proposed Architecture

OpenTeam should keep the existing local-control daemon as the only browser-to-local bridge. ACP support should be implemented behind that daemon:

1. The extension connects only to `127.0.0.1` OpenTeam control daemon as it does today.
2. The daemon owns ACP process or WebSocket configuration.
3. The browser sends high-level `agent.*` commands through the existing authenticated `/command` channel.
4. The daemon translates those commands to ACP requests and streams results back to the extension.

This avoids exposing an arbitrary ACP WebSocket URL directly to AI web pages or content scripts.

## Implemented MVP

- Local agent config is loaded by the daemon from `~/.openteam/acp-agents.json`, or from the `OPENTEAM_ACP_AGENTS` environment variable.
- Daemon capabilities are exposed through the existing token-authenticated `/command` channel:
  - `agent.list`
  - `agent.run`
  - `agent.cancel`
  - `agent.read`
- `agent.run` supports ACP-over-WebSocket endpoints such as a `stdio-to-ws` bridge.
- `agent.run` enforces a per-agent working directory allowlist before sending any prompt to the ACP endpoint.
- `openteamcli agent list` and `openteamcli agent run --agent <id> --content <prompt> --cwd <path>` expose the MVP locally.

Example config:

```json
{
  "agents": [
    {
      "id": "opencode",
      "name": "OpenCode",
      "type": "websocket",
      "url": "ws://127.0.0.1:3030",
      "enabled": true,
      "cwdAllowlist": ["/Users/me/workspace/project"]
    }
  ]
}
```

The default JSON-RPC method sent to the ACP endpoint is `session/prompt` with `{ "prompt": "...", "cwd": "..." }`. Advanced bridges can override the method with `runMethod` in the agent config.

## Remaining UI Follow-Up

- Add team page UI for local agent selection and run status.
- Require explicit user action before sending page-derived prompts from the web UI to a local ACP agent.

## Security Boundaries

- ACP is disabled by default.
- Commands run only through the daemon token-authenticated control channel.
- The daemon should enforce workspace allowlists and reject paths outside approved roots.
- Content scripts should never receive raw local filesystem output unless the user requested that run.
- Store only run metadata and user-visible output in the extension store; do not persist secrets.

## Follow-Up Tasks

- Add optional direct `stdio` process management for ACP agents that are not bridged through WebSocket.
- Add richer streaming result updates once ACP server event shapes are finalized for the target agents.
