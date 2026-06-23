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

## MVP Scope

- Add a local agent config with:
  - name
  - ACP endpoint type: `stdio` or `websocket`
  - command or URL
  - working directory allowlist
  - enabled flag
- Add daemon capabilities:
  - `agent.list`
  - `agent.run`
  - `agent.cancel`
  - `agent.read`
- Add extension UI for connection status and manual enablement.
- Require explicit user action before sending page-derived prompts to a local ACP agent.

## Security Boundaries

- ACP is disabled by default.
- Commands run only through the daemon token-authenticated control channel.
- The daemon should enforce workspace allowlists and reject paths outside approved roots.
- Content scripts should never receive raw local filesystem output unless the user requested that run.
- Store only run metadata and user-visible output in the extension store; do not persist secrets.

## Follow-Up Tasks

- Define ACP command/result schema in `src/shared/localControlProtocol.ts`.
- Extend `packages/openteamcli/openteam-daemon.mjs` with an ACP connector module.
- Add daemon tests for stdio process startup, WebSocket connection, cancellation, timeout, and path allowlists.
- Add team page UI for local agent selection and run status.
