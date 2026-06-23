# GitHub Issue Triage

Last reviewed: 2026-06-23

This document records the current open GitHub issue sweep for `afumu/openteam`.

## Fixed In This Branch

- [#64](https://github.com/afumu/openteam/issues/64) Stop reply disconnect error
  - Added local stop finalization when a site iframe/content-script receiver has disappeared.
  - Keeps explicit content-script stop failures visible.
  - Regression: `src/background/messageHandlers.test.ts`.
- [#63](https://github.com/afumu/openteam/issues/63) DeepSeek prompt text rejected
  - Accepts browser textarea newline normalization for CRLF/CR prompts.
  - Regression: `src/content/sites/deepseek.test.ts`.
- [#45](https://github.com/afumu/openteam/issues/45) Bailian Qwen3 empty response
  - Normalizes DashScope/Bailian root URLs to the official OpenAI-compatible path: `/compatible-mode/v1`.
  - Existing empty-response diagnostics remain in place.
  - Regression: `src/background/externalModelClient.test.ts`.
- [#17](https://github.com/afumu/openteam/issues/17) OpenAI-compatible chat can hang after test succeeds
  - Adds timeout coverage to `client.stream`, which is the path used by formal chat.
  - Regression: `src/background/externalModelClient.test.ts`.
- [#18](https://github.com/afumu/openteam/issues/18) External model timeout and recovery
  - Adds no-token timeout recovery for both streaming and complete paths.
  - Preserves user-initiated aborts so stop reply can still mark replies as stopped.
- [#27](https://github.com/afumu/openteam/issues/27) `@编排` integration with runtime
  - Routes `@编排` and `@编排:名称` chat messages into the orchestration runtime.
  - Adds clear errors when a named flow cannot be found.
  - Regression: `src/background/messageHandlers.test.ts`.
- [#31](https://github.com/afumu/openteam/issues/31) ChatGPT/Gemini image replies
  - Adds Gemini generated-image extraction for trusted `googleusercontent.com` reply images.
  - Extends image attachment capture and bound-frame validation to ChatGPT and Gemini.
  - Regression: `src/content/sites/gemini.test.ts`, `src/background/imageAttachments.test.ts`, `src/background/messageImageHandlers.test.ts`.
- [#9](https://github.com/afumu/openteam/issues/9) ChatGPT two-stage thinking capture
  - Adds explicit coverage that polling waits through ChatGPT generating/thinking state and reports the final answer.
  - Regression: `src/content/replyObserver.test.ts`.
- [#11](https://github.com/afumu/openteam/issues/11) DeepSeek long/streaming reply incomplete
  - Adds explicit coverage that DeepSeek long replies are not reported while the page is still generating.
  - Regression: `src/content/replyObserver.test.ts`.

## Already Covered In Main

- [#14](https://github.com/afumu/openteam/issues/14) Chat copy/new chat should inherit orchestration config
  - Covered by `src/background/groupExperience.test.ts`: copied chats duplicate effective model bindings and remap orchestration flows to copied roles.
- [#8](https://github.com/afumu/openteam/issues/8) Manual @ routing configuration
  - Covered by `src/teamPage/chatHeaderView.test.ts` and `src/background/messageHandlers.test.ts`.
- [#24](https://github.com/afumu/openteam/issues/24) Orchestration save button and test/dry-run entry
  - Covered by `src/teamPage/orchestrationModalView.ts` and related modal tests.
- [#1](https://github.com/afumu/openteam/issues/1), [#2](https://github.com/afumu/openteam/issues/2), [#3](https://github.com/afumu/openteam/issues/3), [#5](https://github.com/afumu/openteam/issues/5), [#7](https://github.com/afumu/openteam/issues/7)
  - These are tracking issues. Most listed child tasks now have code coverage in content reply tracking, group copy, external model, and orchestration test suites.

## Still Design Or Repro Gated

- [#46](https://github.com/afumu/openteam/issues/46) ACP protocol support
  - Requires an explicit protocol/security design before implementation.
  - OpenTeam already has a local-control daemon over HTTP/WebSocket; ACP should be added as a separate local-agent connector instead of exposing arbitrary ACP WebSockets directly to AI pages.
  - Design draft: `docs/ACP.md`.
- [#25](https://github.com/afumu/openteam/issues/25) Attachment data model, size limits, and privacy boundary
  - The image-reply path has a scoped attachment model, but user-uploaded arbitrary files still needs MVP scope and privacy copy before implementation.
  - Design draft: `docs/MULTIMODAL_ATTACHMENTS.md`.
- [#6](https://github.com/afumu/openteam/issues/6) Multimodal attachments
  - Parent design issue remains open until upload, storage, delivery, and unsupported-site fallback are specified.
  - Design draft: `docs/MULTIMODAL_ATTACHMENTS.md`.
- [#19](https://github.com/afumu/openteam/issues/19) AI page health status
  - Existing role status and control status are not yet a unified health protocol.
  - Design draft: `docs/AI_PAGE_HEALTH.md`.
