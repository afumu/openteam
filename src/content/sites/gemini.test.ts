// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createGeminiAdapter } from './gemini'

describe('Gemini site adapter', () => {
  it('extracts Gemini conversation ids and normalized safe urls', () => {
    const adapter = createGeminiAdapter({ href: 'https://gemini.google.com/app/abc-123?hl=en' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://gemini.google.com/app/abc-123?hl=en',
    })
  })

  it('does not report non-Gemini urls', () => {
    const adapter = createGeminiAdapter({ href: 'https://example.com/app/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('writes prompt text into Gemini contenteditable editors', async () => {
    document.body.innerHTML = '<rich-textarea><div contenteditable="true"><p><br></p></div></rich-textarea>'
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createGeminiAdapter().fillAndSend('你好', false)

    expect(editor.textContent).toBe('你好')
    expect(editor.querySelector('hello')).toBeNull()
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('waits for a clickable send button before clicking', async () => {
    document.body.innerHTML = `
      <rich-textarea><div contenteditable="true"></div></rich-textarea>
      <button class="send-button" aria-label="Send" disabled>Send</button>
    `
    const button = document.querySelector<HTMLButtonElement>('button')!
    const clickListener = vi.fn()
    button.addEventListener('click', clickListener)
    window.setTimeout(() => {
      button.disabled = false
    }, 20)

    await createGeminiAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('uses a later clickable Gemini send button when the first match stays disabled', async () => {
    document.body.innerHTML = `
      <rich-textarea><div contenteditable="true"></div></rich-textarea>
      <button class="send-button" aria-label="Send" disabled>Old Send</button>
      <button class="send-button" aria-label="Send">Live Send</button>
    `
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const clickListener = vi.fn()
    buttons[1]?.addEventListener('click', clickListener)

    await createGeminiAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('falls back to keyboard submit when Gemini send button cannot be found', async () => {
    document.body.innerHTML = '<rich-textarea><div contenteditable="true"></div></rich-textarea>'
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    const keydownListener = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Enter') event.preventDefault()
    })
    editor.addEventListener('keydown', keydownListener)

    await createGeminiAdapter({ inputTimeoutMs: 50 }).fillAndSend('hello', true)

    expect(keydownListener).toHaveBeenCalled()
    expect(keydownListener.mock.calls[0]?.[0]?.key).toBe('Enter')
  })

  it('reads assistant replies from deepest Gemini response containers', () => {
    document.body.innerHTML = `
      <model-response>
        <message-content>第一段 <button>copy</button><span aria-hidden="true">hidden</span><p>第二段</p></message-content>
      </model-response>
    `

    expect(createGeminiAdapter().getAllAssistantReplies()).toEqual(['第一段\n第二段'])
  })

  it('uses the Gemini copy action to read markdown replies and restores the clipboard', async () => {
    let clipboardText = '用户原来的剪贴板'
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => clipboardText),
        writeText: vi.fn(async (text: string) => {
          clipboardText = text
        }),
      },
    })
    document.body.innerHTML = `
      <model-response>
        <message-content>
          <p>标题</p>
          <pre><code>const answer = 42</code></pre>
        </message-content>
        <message-actions>
          <copy-button>
            <button aria-label="复制" data-test-id="copy-button">复制</button>
          </copy-button>
        </message-actions>
      </model-response>
    `
    document.querySelector<HTMLButtonElement>('[data-test-id="copy-button"]')?.addEventListener('click', () => {
      clipboardText = '标题\n\n```ts\nconst answer = 42\n```'
    })
    const response = document.querySelector('message-content')!

    const copied = await createGeminiAdapter({ clipboardPollMs: 5, clipboardTimeoutMs: 50 }).readResponseTextFromCopy?.(response)

    expect(copied).toBe('标题\n\n```ts\nconst answer = 42\n```')
    expect(clipboardText).toBe('用户原来的剪贴板')
  })

  it('converts Gemini reply DOM to markdown when copy output is unavailable', () => {
    document.body.innerHTML = `
      <model-response>
        <message-content>
          <h2>方案</h2>
          <p><strong>结论</strong>：可以做</p>
          <ul><li>先做复制</li><li>再做兜底</li></ul>
          <pre><code>const ok = true</code></pre>
        </message-content>
      </model-response>
    `
    const response = document.querySelector('message-content')!

    expect(createGeminiAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以做\n\n- 先做复制\n- 再做兜底\n\n```\nconst ok = true\n```')
  })

  it('extracts generated images from Gemini response containers', () => {
    document.body.innerHTML = `
      <model-response>
        <message-content>
          <p>这里是图片结果。</p>
          <img
            alt="生成图片：产品草图"
            width="1024"
            height="768"
            src="https://lh3.googleusercontent.com/generated-image=s2048"
          >
          <img
            alt="外部跟踪图"
            width="1"
            height="1"
            src="https://example.com/tracker.png"
          >
        </message-content>
        <message-actions>
          <button><img alt="复制图标" src="https://lh3.googleusercontent.com/icon=s24"></button>
        </message-actions>
      </model-response>
    `
    const response = document.querySelector('message-content')!

    expect(createGeminiAdapter().readResponseImages?.(response)).toEqual([{
      sourceUrl: 'https://lh3.googleusercontent.com/generated-image=s2048',
      alt: '生成图片：产品草图',
      width: 1024,
      height: 768,
    }])
  })
})
