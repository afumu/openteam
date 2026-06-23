// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { RoleToBackgroundMessage } from '../group/runtimeProtocol'
import { createReplyObserver } from './replyObserver'
import type { RoleSession } from './roleSession'
import { createChatGptAdapter } from './sites/chatgpt'
import { createDeepSeekAdapter } from './sites/deepseek'
import type { ChatSiteAdapter } from './sites/types'

describe('createReplyObserver', () => {
  it('uses timeout compensation to report a visible reply instead of marking the role as failed', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="old">旧回复</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const adapter = createFakeAdapter({ isGenerating: () => false })
    const reportRoleError = vi.fn()
    const observer = createReplyObserver({
      siteAdapter: adapter,
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError,
    })

    observer.capturePromptReplyBaseline('msg-1')
    roleSession.startPrompt('msg-1', 'attempt-1')
    document.body.insertAdjacentHTML('beforeend', '<message-content id="new">新的回复</message-content>')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(120_000)

    expect(sentMessages).toContainEqual({
      type: 'TEAM_ROLE_REPLY',
      chatId: 'chat-1',
      roleId: 'role-1',
      messageId: 'msg-1',
      replyAttemptId: 'attempt-1',
      content: '新的回复',
      contentFormat: undefined,
      conversationId: 'conv-1',
      conversationUrl: 'https://gemini.google.com/app/conv-1',
    })
    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_STATUS', status: 'error' }))
    expect(reportRoleError).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('reports a same-text reply after a DOM rebuild when it appears after the baseline', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content>好的。</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({ isGenerating: () => false }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-2')
    roleSession.startPrompt('msg-2', 'attempt-2')
    document.body.innerHTML = `
      <message-content>好的。</message-content>
      <message-content>好的。</message-content>
    `
    observer.startReplyPolling('msg-2', 'attempt-2')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-2',
      content: '好的。',
    }))

    vi.useRealTimers()
  })

  it('reports structured timeout reasons when no reply appears', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = ''

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const reportRoleError = vi.fn()
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({ isGenerating: () => false }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError,
    })

    roleSession.startPrompt('msg-1', 'attempt-1')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(120_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_STATUS',
      status: 'error',
      error: 'RESPONSE_NOT_FOUND',
    }))
    expect(reportRoleError).toHaveBeenCalledWith('msg-1', 'RESPONSE_NOT_FOUND', undefined, undefined, 'attempt-1')

    vi.useRealTimers()
  })

  it('keeps polling a very short stable reply so a longer continuation can be collected', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="new">好的。</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const adapter = createFakeAdapter({ isGenerating: () => false })
    const observer = createReplyObserver({
      siteAdapter: adapter,
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    roleSession.startPrompt('msg-1', 'attempt-1')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(4_000)

    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_REPLY' }))

    document.querySelector('message-content')!.textContent = '好的。这里是完整回复：短回复只是开头，后面还会继续补充关键判断、风险和下一步建议，应该等这一整段内容稳定后再上报。'

    await vi.advanceTimersByTimeAsync(4_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      content: '好的。这里是完整回复：短回复只是开头，后面还会继续补充关键判断、风险和下一步建议，应该等这一整段内容稳定后再上报。',
    }))

    vi.useRealTimers()
  })

  it('does not report stable partial text while the page is still generating', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="new">先输出的一段内容，后面还会继续补充。</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const adapter = createFakeAdapter({ isGenerating: () => true })
    const observer = createReplyObserver({
      siteAdapter: adapter,
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    roleSession.startPrompt('msg-1', 'attempt-1')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(20_000)

    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_REPLY' }))

    vi.useRealTimers()
  })

  it('waits for the final ChatGPT two-stage answer instead of reporting the thinking stage', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" data-message-id="reply-old">旧回复</div>
      </section>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createChatGptAdapter({ href: 'https://chatgpt.com/c/conv-1' }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-chatgpt-two-stage')
    roleSession.startPrompt('msg-chatgpt-two-stage', 'attempt-chatgpt-two-stage')
    document.body.insertAdjacentHTML('beforeend', `
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="reply-new" data-turn-start-message="true">
          <div class="markdown"><p>先思考：需要拆解问题。</p></div>
          <div class="result-streaming" aria-busy="true"></div>
        </div>
      </section>
    `)
    observer.startReplyPolling('msg-chatgpt-two-stage', 'attempt-chatgpt-two-stage')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).not.toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-chatgpt-two-stage',
    }))

    document.querySelector('.result-streaming')?.remove()
    document.querySelector('.markdown')!.innerHTML = '<p>最终回答：这里是完整结论、依据、风险和下一步建议。</p>'

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-chatgpt-two-stage',
      replyAttemptId: 'attempt-chatgpt-two-stage',
      content: '最终回答：这里是完整结论、依据、风险和下一步建议。',
    }))

    vi.useRealTimers()
  })

  it('reports a pure image reply after generation settles', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <message-content id="image-reply">
        <img
          alt="已生成图片：产品草图"
          width="1024"
          height="1024"
          src="https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed"
        >
      </message-content>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({
        isGenerating: () => false,
        readResponseImages: node => [...(node as Element).querySelectorAll<HTMLImageElement>('img')].map(image => ({
          sourceUrl: image.src,
          alt: image.alt,
          width: image.width,
          height: image.height,
        })),
      }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    roleSession.startPrompt('msg-image', 'attempt-image')
    observer.startReplyPolling('msg-image', 'attempt-image')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-image',
      replyAttemptId: 'attempt-image',
      content: '',
      images: [{
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed',
        alt: '已生成图片：产品草图',
        width: 1024,
        height: 1024,
      }],
    }))

    vi.useRealTimers()
  })

  it('reports images added to a baseline container that was empty when the prompt was sent', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="image-reply"></message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({
        isGenerating: () => false,
        readResponseImages: node => [...(node as Element).querySelectorAll<HTMLImageElement>('img')].map(image => ({
          sourceUrl: image.src,
          alt: image.alt,
          width: image.width,
          height: image.height,
        })),
      }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-image')
    roleSession.startPrompt('msg-image', 'attempt-image')
    document.querySelector('message-content')!.innerHTML = `
      <img
        alt="已生成图片"
        width="1254"
        height="1254"
        src="https://chatgpt.com/backend-api/estuary/content?id=file-image-1"
      >
      <img
        alt="已生成图片"
        width="1254"
        height="1254"
        src="https://chatgpt.com/backend-api/estuary/content?id=file-image-2"
      >
    `
    observer.startReplyPolling('msg-image', 'attempt-image')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-image',
      replyAttemptId: 'attempt-image',
      content: '',
      images: [
        expect.objectContaining({ sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-1' }),
        expect.objectContaining({ sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-2' }),
      ],
    }))

    vi.useRealTimers()
  })

  it('reports a ChatGPT generated image turn through the mutation observer', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" data-message-id="reply-1">旧回复</div>
      </section>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createChatGptAdapter({ href: 'https://chatgpt.com/c/conv-1' }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.startReplyReporting()
    observer.capturePromptReplyBaseline('msg-chatgpt-image')
    roleSession.startPrompt('msg-chatgpt-image', 'attempt-chatgpt-image')
    document.body.insertAdjacentHTML('beforeend', `
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              width="1254"
              height="1254"
              alt="已生成图片"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one"
            >
          </div>
        </div>
      </section>
    `)
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-chatgpt-image',
      replyAttemptId: 'attempt-chatgpt-image',
      content: '',
      images: [{
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one',
        alt: '已生成图片',
        width: 1254,
        height: 1254,
      }],
    }))

    vi.useRealTimers()
  })

  it('reports a new image prepended before a baseline image instead of treating it as old', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-old">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              alt="旧图片"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-old"
            >
          </div>
        </div>
      </section>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createChatGptAdapter({ href: 'https://chatgpt.com/c/conv-1' }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-new-image')
    roleSession.startPrompt('msg-new-image', 'attempt-new-image')
    document.body.insertAdjacentHTML('afterbegin', `
      <section data-turn="assistant" data-testid="conversation-turn-new">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              alt="新图片"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-new"
            >
          </div>
        </div>
      </section>
    `)
    observer.startReplyPolling('msg-new-image', 'attempt-new-image')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-new-image',
      images: [expect.objectContaining({
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-new',
        alt: '新图片',
      })],
    }))
    expect(sentMessages).not.toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      images: [expect.objectContaining({
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-old',
      })],
    }))

    vi.useRealTimers()
  })

  it('extends the reply timeout while the page is still generating', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="new">先输出的一段内容，仍在思考后续。</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const reportRoleError = vi.fn()
    let generating = true
    const adapter = createFakeAdapter({ isGenerating: () => generating })
    const observer = createReplyObserver({
      siteAdapter: adapter,
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError,
    })

    roleSession.startPrompt('msg-1', 'attempt-1')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(120_000)

    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_REPLY' }))
    expect(sentMessages).toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_STATUS', status: 'generating' }))
    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_STATUS', status: 'error' }))
    expect(reportRoleError).not.toHaveBeenCalled()

    document.querySelector('message-content')!.textContent = '先输出的一段内容，仍在思考后续。现在补充完成。'
    generating = false
    await vi.advanceTimersByTimeAsync(120_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-1',
      content: '先输出的一段内容，仍在思考后续。现在补充完成。',
    }))
    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_STATUS', status: 'error' }))
    expect(reportRoleError).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('does not send idle for an old reply after a new prompt starts in the same frame', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = ''

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    let finishReplyReport: (() => void) | undefined
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({ isGenerating: () => false }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        if (message.type === 'TEAM_ROLE_REPLY') {
          await new Promise<void>(resolve => {
            finishReplyReport = resolve
          })
        }
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-1')
    roleSession.startPrompt('msg-1', 'attempt-1')
    document.body.insertAdjacentHTML('beforeend', '<message-content id="new">第一段工程师回复已经完成，包含需求合理性判断、技术风险、实现步骤、边界条件和下一步建议，准备进入下一个工程师节点继续处理。</message-content>')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(6_000)
    expect(sentMessages).toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_REPLY', messageId: 'msg-1' }))

    roleSession.startPrompt('msg-2', 'attempt-2')
    finishReplyReport?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(sentMessages).not.toContainEqual(expect.objectContaining({ type: 'TEAM_ROLE_STATUS', status: 'idle' }))

    vi.useRealTimers()
  })

  it('keeps the stable polling window when the reply text stays the same but DeepSeek-style containers are replaced', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<message-content id="reply-a">这是一个已经完整渲染结束的 DeepSeek 回复内容，文本本身没有继续变化，但容器节点会被虚拟列表替换。</message-content>'

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const adapter = createFakeAdapter({ isGenerating: () => false })
    const observer = createReplyObserver({
      siteAdapter: adapter,
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    roleSession.startPrompt('msg-1', 'attempt-1')
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(2_000)
    document.querySelector('message-content')?.replaceWith(createMessageContent('reply-b', '这是一个已经完整渲染结束的 DeepSeek 回复内容，文本本身没有继续变化，但容器节点会被虚拟列表替换。'))
    await vi.advanceTimersByTimeAsync(2_000)
    document.querySelector('message-content')?.replaceWith(createMessageContent('reply-c', '这是一个已经完整渲染结束的 DeepSeek 回复内容，文本本身没有继续变化，但容器节点会被虚拟列表替换。'))
    await vi.advanceTimersByTimeAsync(2_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-1',
      content: '这是一个已经完整渲染结束的 DeepSeek 回复内容，文本本身没有继续变化，但容器节点会被虚拟列表替换。',
    }))

    vi.useRealTimers()
  })

  it('reports a new reply when DeepSeek virtual list prunes older baseline containers', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <message-content id="old-1">历史回复 1</message-content>
      <message-content id="old-2">历史回复 2</message-content>
      <message-content id="old-3">历史回复 3</message-content>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createFakeAdapter({ isGenerating: () => false }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-1')
    roleSession.startPrompt('msg-1', 'attempt-1')
    document.body.innerHTML = `
      <message-content id="old-3-rebuilt">历史回复 3</message-content>
      <message-content id="new-reply">这是 DeepSeek 在虚拟列表裁剪历史节点后出现的新回复。</message-content>
    `
    observer.startReplyPolling('msg-1', 'attempt-1')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-1',
      content: '这是 DeepSeek 在虚拟列表裁剪历史节点后出现的新回复。',
    }))

    vi.useRealTimers()
  })

  it('waits for DeepSeek long streaming replies to finish before reporting', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <div data-virtual-list-item-key="1">
        <div class="ds-message">
          <div class="ds-markdown"><p>历史回复</p></div>
        </div>
      </div>
    `

    const sentMessages: RoleToBackgroundMessage[] = []
    const roleSession = createFakeRoleSession()
    const observer = createReplyObserver({
      siteAdapter: createDeepSeekAdapter({ href: 'https://chat.deepseek.com/a/chat/s/conv-1' }),
      roleSession,
      log: createFakeLog(),
      sendRuntimeMessage: async message => {
        sentMessages.push(message)
        return { ok: true } as never
      },
      reportRoleError: vi.fn(),
    })

    observer.capturePromptReplyBaseline('msg-deepseek-long')
    roleSession.startPrompt('msg-deepseek-long', 'attempt-deepseek-long')
    document.body.insertAdjacentHTML('beforeend', `
      <div data-virtual-list-item-key="2">
        <div class="ds-message">
          <div class="ds-markdown"><p>先输出的一段长回复，后面还会继续补全。</p></div>
        </div>
      </div>
      <button type="button" aria-label="停止生成">停止</button>
    `)
    observer.startReplyPolling('msg-deepseek-long', 'attempt-deepseek-long')

    await vi.advanceTimersByTimeAsync(20_000)

    expect(sentMessages).not.toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-deepseek-long',
    }))

    const finalText = '先输出的一段长回复，后面还会继续补全。现在补齐完整结论、关键依据、风险判断、执行步骤和验收标准。'
    document.querySelector('button[aria-label="停止生成"]')?.remove()
    document.querySelectorAll('.ds-markdown')[1]!.innerHTML = `<p>${finalText}</p>`

    await vi.advanceTimersByTimeAsync(8_000)

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'TEAM_ROLE_REPLY',
      messageId: 'msg-deepseek-long',
      replyAttemptId: 'attempt-deepseek-long',
      content: finalText,
    }))

    vi.useRealTimers()
  })
})

function createFakeRoleSession(): RoleSession {
  let activeMessageId: string | undefined
  let activeReplyAttemptId: string | undefined

  return {
    getAssignedRole: () => ({ chatId: 'chat-1', roleId: 'role-1', roleName: '工程师' }),
    getActivePrompt: () => (activeMessageId ? { messageId: activeMessageId, replyAttemptId: activeReplyAttemptId } : undefined),
    getActiveMessageId: () => activeMessageId,
    getActiveReplyAttemptId: () => activeReplyAttemptId,
    getAssignedChatId: () => 'chat-1',
    assignRole: vi.fn(),
    startPrompt(messageId, replyAttemptId): void {
      activeMessageId = messageId
      activeReplyAttemptId = replyAttemptId
    },
    clearActivePrompt(messageId): string | undefined {
      if (messageId && activeMessageId !== messageId) return activeReplyAttemptId
      const replyAttemptId = activeReplyAttemptId
      activeMessageId = undefined
      activeReplyAttemptId = undefined
      return replyAttemptId
    },
  }
}

function createFakeAdapter(overrides: Partial<ChatSiteAdapter> = {}): ChatSiteAdapter {
  return {
    id: 'gemini',
    getConversationSnapshot: () => ({ conversationId: 'conv-1', conversationUrl: 'https://gemini.google.com/app/conv-1' }),
    getConversationId: () => 'conv-1',
    getResponseContainers: () => [...document.querySelectorAll('message-content')],
    getAllAssistantReplies: () => [...document.querySelectorAll('message-content')].map(element => element.textContent ?? '').filter(Boolean),
    readResponseText: node => node.textContent ?? '',
    findResponseContainer: element => element?.closest('message-content') ?? null,
    isGenerating: () => true,
    stopGenerating: vi.fn(async () => true),
    fillAndSend: vi.fn(),
    collectPromptDiagnostics: () => ({}),
    ...overrides,
  }
}

function createFakeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createMessageContent(id: string, text: string): HTMLElement {
  const element = document.createElement('message-content')
  element.id = id
  element.textContent = text
  return element
}
