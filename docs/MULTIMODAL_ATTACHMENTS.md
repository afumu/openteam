# Multimodal Attachments Design

## Goal

Support image and file attachments in group chat while keeping storage, delivery, and privacy behavior predictable.

## Existing State

OpenTeam already supports captured ChatGPT image replies:

- `ReplyImageSource` travels from content script to background.
- `MessageImageAttachment` stores metadata on group messages.
- Image blobs are saved in IndexedDB through `ImageAttachmentRepository`.
- The team page renders image grids with preview, download, loading, and failure states.

That implementation is intentionally source-restricted to ChatGPT/OpenAI image hosts.

## MVP Upload Model

First user-upload MVP should support:

- PNG, JPEG, WebP, GIF, AVIF images up to 25 MB each.
- Plain text and Markdown up to 1 MB each.
- PDF metadata only until a site/API delivery path is defined.

Each attachment should store:

- id
- message id
- type
- mime type
- size
- display name
- storage status
- created timestamp
- source: `user-upload` or `site-reply`

## Storage Strategy

- Store blobs locally in IndexedDB.
- Store only metadata in the group store.
- Delete blobs when messages, chats, or stores are deleted.
- Do not upload or sync attachments to third-party services unless the user explicitly sends them.

## Delivery Rules

- Sites with native upload support can receive files only after a per-send confirmation.
- Sites without upload support receive a textual fallback describing the attachment name, type, and size.
- External API delivery should be a separate capability flag because providers differ on image/file formats.

## Privacy Copy

Before first attachment send, show concise copy:

> Attachments stay local until you send them. Sending to an AI site or external model may upload the file to that provider.

## Follow-Up Tasks

- Add user upload UI in `src/teamPage/composerView.ts`.
- Add upload blob repository methods beside `ImageAttachmentRepository`.
- Extend `GroupMessage.attachments` beyond image replies.
- Add adapter capability metadata for site upload support.
- Add tests for size limits, unsupported-site fallback, and deletion cleanup.
