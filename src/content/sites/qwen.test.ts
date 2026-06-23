// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createQwenAdapter } from './qwen'

describe('Qwen site adapter', () => {
  it('extracts Qwen conversation ids and normalized safe urls', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai/c/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://chat.qwen.ai/c/abc-123',
    })
  })

  it('extracts qwen id from chat path', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai/chat/xyz-789' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'xyz-789',
      conversationUrl: 'https://chat.qwen.ai/chat/xyz-789',
    })
  })

  it('extracts qwen id from s path', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai/s/session-001?model=qwen-max' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'session-001',
      conversationUrl: 'https://chat.qwen.ai/s/session-001?model=qwen-max',
    })
  })

  it('does not report non-Qwen urls', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai.evil.example/c/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('returns default conversation id on the home page', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai/' })

    expect(adapter.getConversationId()).toBe('__default__')
  })

  it('writes prompt text into textarea', async () => {
    document.body.innerHTML = '<textarea class="message-input-textarea" placeholder="有什么我能帮您的吗？"></textarea>'
    const editor = document.querySelector<HTMLTextAreaElement>('textarea')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createQwenAdapter().fillAndSend('你好 千问', false)

    expect(editor.value).toBe('你好 千问')
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('waits for a clickable send button before clicking', async () => {
    document.body.innerHTML = `
      <textarea class="message-input-textarea" placeholder="有什么我能帮您的吗？"></textarea>
      <div class="message-input-right-button-send">
        <button class="send-button">发送</button>
      </div>
    `
    const button = document.querySelector<HTMLElement>('button.send-button')!
    const clickListener = vi.fn()
    button.addEventListener('click', clickListener)

    await createQwenAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('does not click a disabled send button', async () => {
    document.body.innerHTML = `
      <textarea class="message-input-textarea" placeholder="有什么我能帮您的吗？"></textarea>
      <div class="message-input-right-button-send">
        <button class="send-button" disabled>发送</button>
      </div>
    `
    const button = document.querySelector<HTMLElement>('button.send-button')!
    const clickListener = vi.fn()
    button.addEventListener('click', clickListener)

    await createQwenAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).not.toHaveBeenCalled()
  })

  it('detects when no conversation messages exist', () => {
    document.body.innerHTML = '<main class="main-content"><div class="placeholder-container"><div class="placeholder-text-container">你想知道什么？</div></div></main>'

    expect(createQwenAdapter().getAllAssistantReplies()).toEqual([])
  })

  it('reads Qwen assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-assistant">
          <p>这是千问的回答内容</p>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['这是千问的回答内容'])
  })

  it('ignores user messages when reading assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-user">
          <p>用户发送的提示词</p>
        </div>
        <div class="qwen-chat-message-assistant">
          <p>这是千问的回复</p>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['这是千问的回复'])
  })

  it('excludes status card text from assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-assistant">
          <div class="qwen-chat-tool-status-card qwen-chat-thinking-status-card-completed">
            <div class="qwen-chat-thinking-status-card-title-text">已经完成思考</div>
          </div>
          <div class="qwen-chat-tool-status-card qwen-chat-searching-status-card">
            <div>正在搜索网络</div>
          </div>
          <div class="response-message-content">
            <p>最终的回复内容</p>
          </div>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['最终的回复内容'])
  })

  it('excludes footer container from assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-assistant">
          <div class="response-message-content">
            <p>千问的回复</p>
          </div>
          <div class="message-hoc-container">
            <div class="response-message-footer">
              <button>复制</button>
              <a href="#ref1">[1]</a>
              <a href="#ref2">[2]</a>
            </div>
          </div>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['千问的回复'])
  })

  it('strips hyperlinks from assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-assistant">
          <div class="response-message-content">
            <p>引用来源<a href="https://baidu.com">百度</a><a href="https://adjust.com">好耶</a>的结论</p>
          </div>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['引用来源的结论'])
  })

  it('strips citation spans from assistant replies', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="qwen-chat-message-assistant">
          <div class="response-message-content">
            <p>北极星指标的定义<span class="qwen-markdown-citation"><span class="qwen-chat-markdown-tokens-hostname">163网易免费邮</span></span>参考来源</p>
          </div>
        </div>
      </main>
    `

    const replies = createQwenAdapter().getAllAssistantReplies()
    expect(replies).toEqual(['北极星指标的定义参考来源'])
  })

  it('converts Qwen reply DOM to markdown', () => {
    document.body.innerHTML = `
      <div class="qwen-chat-message-assistant">
        <div class="response-message-content">
          <h2>方案</h2>
          <p><strong>结论</strong>：可以实现</p>
          <ul><li>接入 adapter</li><li>验证登录态</li></ul>
        </div>
      </div>
    `
    const response = document.querySelector('.qwen-chat-message-assistant')!

    expect(createQwenAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以实现\n\n- 接入 adapter\n- 验证登录态')
  })

  it('preserves bold formatting in Qwen div paragraphs', () => {
    document.body.innerHTML = `
      <div class="qwen-chat-message-assistant">
        <div class="response-message-content">
          <div class="qwen-markdown">
            <div class="qwen-markdown-paragraph">
              <span class="qwen-markdown-text">❌ </span>
              <strong class="qwen-markdown-strong"><span class="qwen-markdown-text">内容时效存疑</span></strong>
              <span class="qwen-markdown-text">：你说的有道理。</span>
            </div>
            <div class="qwen-markdown-space"></div>
            <div class="qwen-markdown-paragraph">
              <span class="qwen-markdown-text">✅ </span>
              <strong class="qwen-markdown-strong"><span class="qwen-markdown-text">思路可取</span></strong>
              <span class="qwen-markdown-text">：方向正确。</span>
            </div>
          </div>
        </div>
      </div>
    `
    const response = document.querySelector('.qwen-chat-message-assistant')!

    const markdown = createQwenAdapter().readResponseMarkdown?.(response)
    expect(markdown).toContain('**内容时效存疑**')
    expect(markdown).toContain('**思路可取**')
    expect(markdown).not.toContain('strong')
    // Each div-paragraph is separated by a blank line
    expect(markdown!.match(/\n\n/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('separates Qwen div paragraphs with blank lines', () => {
    document.body.innerHTML =
      '<div class="qwen-chat-message-assistant">' +
        '<div class="response-message-content">' +
          '<div class="qwen-markdown">' +
            '<div class="qwen-markdown-paragraph">' +
              '<strong class="qwen-markdown-strong"><span class="qwen-markdown-text">1. 标题一</span></strong>' +
              '<br>' +
              '<span class="qwen-markdown-text">内容一</span>' +
            '</div>' +
            '<div class="qwen-markdown-space"></div>' +
            '<div class="qwen-markdown-paragraph">' +
              '<strong class="qwen-markdown-strong"><span class="qwen-markdown-text">2. 标题二</span></strong>' +
              '<br>' +
              '<span class="qwen-markdown-text">内容二</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    const response = document.querySelector('.qwen-chat-message-assistant')!

    const markdown = createQwenAdapter().readResponseMarkdown?.(response)
    expect(markdown).toContain('**1. 标题一**')
    expect(markdown).toContain('**2. 标题二**')
    expect(markdown).toMatch(/\*\*1\. 标题一\*\*[\s\S]*?\n\n\*\*2\. 标题二\*\*/)
  })

  it('converts blockquote without leaking to subsequent text', () => {
    document.body.innerHTML = `
      <div class="qwen-chat-message-assistant">
        <div class="response-message-content">
          <div class="qwen-markdown">
            <blockquote class="qwen-markdown-blockquote">
              <p>引用的话</p>
            </blockquote>
            <p>普通的话</p>
          </div>
        </div>
      </div>
    `
    const response = document.querySelector('.qwen-chat-message-assistant')!

    const markdown = createQwenAdapter().readResponseMarkdown?.(response)
    expect(markdown).toContain('> 引用的话')
    expect(markdown).toContain('普通的话')
    // The blockquote should not extend to the plain text
    const quoteIndex = markdown!.indexOf('> 引用的话')
    const plainIndex = markdown!.indexOf('普通的话')
    expect(plainIndex).toBeGreaterThan(quoteIndex)
  })

  it('does not report generation when no stop button', () => {
    document.body.innerHTML = '<div>no stop button</div>'

    expect(createQwenAdapter().isGenerating()).toBe(false)
  })

  it('detects stop button as active generation', () => {
    document.body.innerHTML = '<button>停止生成</button>'

    expect(createQwenAdapter().isGenerating()).toBe(true)
  })

  it('stops generation by clicking stop button', async () => {
    document.body.innerHTML = '<button>停止</button>'
    const button = document.querySelector('button')!
    const clickListener = vi.fn()
    button.addEventListener('click', clickListener)

    const result = await createQwenAdapter().stopGenerating()

    expect(result).toBe(true)
    expect(clickListener).toHaveBeenCalledTimes(1)
  })
})
