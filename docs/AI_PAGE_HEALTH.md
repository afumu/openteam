# AI Page Health Status Design

## Goal

Show a clear per-role health status so users know whether an AI page is loaded, connected, ready to send, waiting for a reply, blocked, or failed.

## Status Model

Add a protocol-level health state separate from the current role reply status:

- `iframe-loading`: iframe exists but no content-script handshake yet.
- `content-connected`: content script responded but no site readiness check has passed.
- `login-required`: site UI indicates login or blocked access.
- `ready`: prompt editor and send path are available.
- `sending`: prompt delivery is in progress.
- `waiting-reply`: prompt was accepted and reply tracking is active.
- `reply-failed`: reply tracking or delivery failed with diagnostics.
- `disconnected`: frame binding was lost or content script receiver disappeared.

## Data Flow

1. Content scripts report site health through `TEAM_ROLE_STATUS` or a new `TEAM_ROLE_HEALTH` message.
2. Background stores the latest health snapshot per role in runtime-only state or persisted store metadata.
3. Team page renders compact health badges in the role panel and message composer.

## Anti-Flicker Rules

- Debounce transient loading states for 300 ms.
- Do not downgrade from `ready` to `iframe-loading` unless the frame binding changes.
- Keep the last diagnostic reason until the next successful ready state.

## Follow-Up Tasks

- Add `RoleHealthStatus` type to `src/group/runtimeProtocol.ts`.
- Extend `src/content/frameHandshake.ts` to report health snapshots.
- Add health rendering to `src/teamPage/agentControlStatusView.ts` or a new per-role status component.
- Add tests for handshake, disconnect, login-required, and retry transitions.
