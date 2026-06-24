// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleToBackgroundMessage } from '../group/runtimeProtocol'
import type { ChatSiteAdapter } from './sites/types'

describe('content entrypoint site status heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    document.body.innerHTML = '<main></main>'
    delete (window as unknown as Record<string, unknown>).__OPENTEAM_LOADED__
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    delete (window as unknown as Record<string, unknown>).__OPENTEAM_LOADED__
  })

  it('starts site status heartbeat inside direct role frames', async () => {
    const sendRuntimeMessage = await bootContentEntrypoint({ embedded: true, directEmbedded: true })

    await vi.advanceTimersByTimeAsync(5000)

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'TEAM_SITE_STATUS_UPDATE',
      siteId: 'chatgpt',
      status: 'blocked',
      detail: 'Access Denied',
    }, expect.anything())
  })
})

async function bootContentEntrypoint(options: { embedded: boolean; directEmbedded: boolean }) {
  const sendRuntimeMessage = vi.fn(async (_message: RoleToBackgroundMessage) => ({ ok: true }))
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn(),
      },
    },
  })

  vi.doMock('./frameEnvironment', () => ({
    isEmbeddedFrame: () => options.embedded,
    isDirectEmbeddedFrame: () => options.directEmbedded,
  }))
  vi.doMock('./sites', () => ({
    getActiveChatSiteAdapter: () => createAdapter(),
  }))
  vi.doMock('./runtimeClient', () => ({
    contentLog: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    sendRuntimeMessage,
  }))
  vi.doMock('./conversationMonitor', () => ({
    createConversationMonitor: () => ({
      reportConversationUpdate: vi.fn(),
      start: vi.fn(),
    }),
  }))
  vi.doMock('./replyObserver', () => ({
    createReplyObserver: () => ({
      capturePromptReplyBaseline: vi.fn(),
      clearPromptReplyBaseline: vi.fn(),
      clearReplyPolling: vi.fn(),
      startReplyPolling: vi.fn(),
      startReplyReporting: vi.fn(),
      seedStoredRoleReplies: vi.fn(),
      resetForAssignedRole: vi.fn(),
    }),
  }))
  vi.doMock('./frameHandshake', () => ({
    registerFrameRoleHandshake: vi.fn(),
  }))

  await import('./index')
  return sendRuntimeMessage
}

function createAdapter(): ChatSiteAdapter {
  return {
    id: 'chatgpt',
    getConversationSnapshot: () => ({
      conversationId: 'conversation-1',
      conversationUrl: 'https://chatgpt.com/c/conversation-1',
    }),
    getConversationId: () => 'conversation-1',
    getResponseContainers: () => [],
    getAllAssistantReplies: () => [],
    readResponseText: () => '',
    findResponseContainer: () => null,
    isGenerating: () => false,
    checkStatus: () => ({
      status: 'blocked',
      detail: 'Access Denied',
      timestamp: Date.now(),
    }),
    stopGenerating: async () => false,
    fillAndSend: async () => undefined,
    collectPromptDiagnostics: () => ({}),
  }
}
