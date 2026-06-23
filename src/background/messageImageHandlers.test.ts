import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, RuntimeFrameBinding } from '../group/types'

describe('background image reply handling', () => {
  it('stores a pure image reply with captured attachment metadata', async () => {
    vi.resetModules()
    let currentStore = createImageReplyStore()
    vi.doMock('./storeAccess', async importOriginal => {
      const actual = await importOriginal<typeof import('./storeAccess')>()
      return {
        ...actual,
        mutateStore: vi.fn(async (mutator: (store: OpenTeamStore) => unknown) => {
          const result = await mutator(currentStore)
          currentStore = structuredClone(currentStore)
          return { store: currentStore, result }
        }),
      }
    })

    const captureReplyImages = vi.fn(async () => [{
      id: 'attachment-1',
      type: 'image' as const,
      status: 'ready' as const,
      alt: '已生成图片：产品草图',
      width: 1024,
      height: 1024,
      mimeType: 'image/png',
      size: 128,
      fileName: 'chatgpt-image-1.png',
    }])
    const binding: RuntimeFrameBinding = {
      chatId: 'chat-1',
      roleId: 'role-1',
      tabId: 101,
      frameId: 7,
      ready: true,
      lastSeenAt: 1,
    }
    const { createMessageHandlers } = await import('./messageHandlers')
    const routes = createMessageHandlers({
      broadcastStoreUpdated: vi.fn(),
      getChatStatusFromRoles: () => 'ready',
      imageAttachments: {
        captureReplyImages,
        deleteByIds: vi.fn(async () => undefined),
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      newId: vi.fn((prefix: string) => prefix === 'msg' ? 'msg-image' : `${prefix}-1`),
      now: vi.fn(() => 100),
      runtimeFrames: {
        bind: vi.fn(),
        getByAddress: vi.fn(() => binding),
        getByRole: vi.fn(() => binding),
      },
      sendRoleMessage: vi.fn(),
      sendError: vi.fn(),
      sendPrompt: vi.fn(),
    })

    const replyRoute = routes.find(route => route.type === 'TEAM_ROLE_REPLY')
    const response = await replyRoute?.handler({
      type: 'TEAM_ROLE_REPLY',
      chatId: 'chat-1',
      roleId: 'role-1',
      messageId: 'msg-user',
      replyAttemptId: 'attempt-1',
      content: '',
      images: [{
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=secret',
        alt: '已生成图片：产品草图',
        width: 1024,
        height: 1024,
      }],
    }, {
      tab: { id: 101 } as chrome.tabs.Tab,
      frameId: 7,
      url: 'https://chatgpt.com/c/conversation',
    }) as { ok: boolean; message: { id: string }; store: OpenTeamStore }

    expect(response.ok).toBe(true)
    expect(captureReplyImages).toHaveBeenCalledWith({
      chatId: 'chat-1',
      messageId: 'msg-image',
      images: [{
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=secret',
        alt: '已生成图片：产品草图',
        width: 1024,
        height: 1024,
      }],
    })
    expect(response.store.messagesById['msg-image']).toMatchObject({
      id: 'msg-image',
      type: 'assistant',
      content: '',
      attachments: [{
        id: 'attachment-1',
        type: 'image',
        status: 'ready',
      }],
    })
    expect(response.store.messagesById['msg-user'].deliveryStatus?.['role-1']).toBe('received')
  })

  it('accepts image replies from a bound Gemini frame', async () => {
    vi.resetModules()
    let currentStore = createImageReplyStore('gemini')
    vi.doMock('./storeAccess', async importOriginal => {
      const actual = await importOriginal<typeof import('./storeAccess')>()
      return {
        ...actual,
        mutateStore: vi.fn(async (mutator: (store: OpenTeamStore) => unknown) => {
          const result = await mutator(currentStore)
          currentStore = structuredClone(currentStore)
          return { store: currentStore, result }
        }),
      }
    })

    const captureReplyImages = vi.fn(async () => [{
      id: 'attachment-gemini',
      type: 'image' as const,
      status: 'ready' as const,
      alt: '生成图片：产品草图',
      mimeType: 'image/webp',
      size: 128,
      fileName: 'gemini-image-1.webp',
    }])
    const binding: RuntimeFrameBinding = {
      chatId: 'chat-1',
      roleId: 'role-1',
      tabId: 202,
      frameId: 8,
      ready: true,
      lastSeenAt: 1,
    }
    const { createMessageHandlers } = await import('./messageHandlers')
    const routes = createMessageHandlers({
      broadcastStoreUpdated: vi.fn(),
      getChatStatusFromRoles: () => 'ready',
      imageAttachments: {
        captureReplyImages,
        deleteByIds: vi.fn(async () => undefined),
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      newId: vi.fn((prefix: string) => prefix === 'msg' ? 'msg-gemini-image' : `${prefix}-1`),
      now: vi.fn(() => 100),
      runtimeFrames: {
        bind: vi.fn(),
        getByAddress: vi.fn(() => binding),
        getByRole: vi.fn(() => binding),
      },
      sendRoleMessage: vi.fn(),
      sendError: vi.fn(),
      sendPrompt: vi.fn(),
    })

    const replyRoute = routes.find(route => route.type === 'TEAM_ROLE_REPLY')
    const response = await replyRoute?.handler({
      type: 'TEAM_ROLE_REPLY',
      chatId: 'chat-1',
      roleId: 'role-1',
      messageId: 'msg-user',
      replyAttemptId: 'attempt-1',
      content: '',
      images: [{
        sourceUrl: 'https://lh3.googleusercontent.com/generated-image=s2048',
        alt: '生成图片：产品草图',
      }],
    }, {
      tab: { id: 202 } as chrome.tabs.Tab,
      frameId: 8,
      url: 'https://gemini.google.com/app/conversation',
    }) as { ok: boolean; message: { id: string }; store: OpenTeamStore }

    expect(response.ok).toBe(true)
    expect(captureReplyImages).toHaveBeenCalledWith({
      chatId: 'chat-1',
      messageId: 'msg-gemini-image',
      images: [{
        sourceUrl: 'https://lh3.googleusercontent.com/generated-image=s2048',
        alt: '生成图片：产品草图',
      }],
    })
    expect(response.store.messagesById['msg-gemini-image']).toMatchObject({
      id: 'msg-gemini-image',
      type: 'assistant',
      content: '',
      attachments: [{
        id: 'attachment-gemini',
        type: 'image',
        status: 'ready',
      }],
    })
  })

  it('keeps stale image replies ignored when attachment cleanup fails', async () => {
    vi.resetModules()
    let currentStore = createImageReplyStore()
    currentStore.rolesById['role-1'].lastPromptMessageId = 'msg-newer'
    vi.doMock('./storeAccess', async importOriginal => {
      const actual = await importOriginal<typeof import('./storeAccess')>()
      return {
        ...actual,
        mutateStore: vi.fn(async (mutator: (store: OpenTeamStore) => unknown) => {
          const result = await mutator(currentStore)
          currentStore = structuredClone(currentStore)
          return { store: currentStore, result }
        }),
      }
    })

    const deleteByIds = vi.fn(async () => {
      throw new Error('indexeddb unavailable')
    })
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const binding: RuntimeFrameBinding = {
      chatId: 'chat-1',
      roleId: 'role-1',
      tabId: 101,
      frameId: 7,
      ready: true,
      lastSeenAt: 1,
    }
    const { createMessageHandlers } = await import('./messageHandlers')
    const routes = createMessageHandlers({
      broadcastStoreUpdated: vi.fn(),
      getChatStatusFromRoles: () => 'ready',
      imageAttachments: {
        captureReplyImages: vi.fn(async () => [{
          id: 'attachment-stale',
          type: 'image' as const,
          status: 'ready' as const,
        }]),
        deleteByIds,
      },
      log,
      newId: vi.fn((prefix: string) => prefix === 'msg' ? 'msg-stale' : `${prefix}-1`),
      now: vi.fn(() => 100),
      runtimeFrames: {
        bind: vi.fn(),
        getByAddress: vi.fn(() => binding),
        getByRole: vi.fn(() => binding),
      },
      sendRoleMessage: vi.fn(),
      sendError: vi.fn(),
      sendPrompt: vi.fn(),
    })

    const replyRoute = routes.find(route => route.type === 'TEAM_ROLE_REPLY')
    const response = await replyRoute?.handler({
      type: 'TEAM_ROLE_REPLY',
      chatId: 'chat-1',
      roleId: 'role-1',
      messageId: 'msg-user',
      replyAttemptId: 'attempt-1',
      content: '',
      images: [{ sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=stale' }],
    }, {
      tab: { id: 101 } as chrome.tabs.Tab,
      frameId: 7,
      url: 'https://chatgpt.com/c/conversation',
    }) as { ok: boolean; ignored?: boolean }

    expect(response).toMatchObject({ ok: true, ignored: true })
    expect(deleteByIds).toHaveBeenCalledWith(['attachment-stale'])
    expect(log.warn).toHaveBeenCalledWith('role-reply:attachment-cleanup-failed', expect.objectContaining({
      attachmentCount: 1,
    }))
  })
})

function createImageReplyStore(chatSite: GroupRole['chatSite'] = 'chatgpt'): OpenTeamStore {
  const store = createDefaultStore()
  const chat: GroupChat = {
    id: 'chat-1',
    name: '图片讨论',
    mode: 'independent',
    roleIds: ['role-1'],
    messageIds: ['msg-user'],
    nextMessageSeq: 2,
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
  }
  const role: GroupRole = {
    id: 'role-1',
    chatId: chat.id,
    chatSite,
    name: '视觉设计师',
    status: 'thinking',
    contextCursor: 1,
    lastPromptMessageId: 'msg-user',
    replyAttemptId: 'attempt-1',
    createdAt: 1,
    updatedAt: 1,
  }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.rolesById[role.id] = role
  store.messagesById['msg-user'] = {
    id: 'msg-user',
    chatId: chat.id,
    seq: 1,
    type: 'user',
    content: '请生成一张产品草图',
    targetRoleIds: [role.id],
    createdAt: 1,
    status: 'sent',
    deliveryStatus: { [role.id]: 'sent' },
  }
  return store
}
