// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createDeepSeekAdapter } from './deepseek'

describe('DeepSeek site adapter', () => {
  it('extracts DeepSeek conversation ids and normalized safe urls', () => {
    const adapter = createDeepSeekAdapter({ href: 'https://chat.deepseek.com/a/chat/s/abc-123?model=deepseek-chat' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://chat.deepseek.com/a/chat/s/abc-123?model=deepseek-chat',
    })
  })

  it('does not report non-DeepSeek urls', () => {
    const adapter = createDeepSeekAdapter({ href: 'https://chat.deepseek.com.evil.example/a/chat/s/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('writes prompt text into the DeepSeek textarea composer', async () => {
    document.body.innerHTML = `
      <div class="aaff8b8f">
        <textarea name="search" placeholder="给 DeepSeek 发送消息 "></textarea>
      </div>
    `
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createDeepSeekAdapter().fillAndSend('你好 <deepseek>', false)

    expect(editor.value).toBe('你好 <deepseek>')
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('accepts prompts after textarea newline normalization', async () => {
    document.body.innerHTML = `
      <div class="aaff8b8f">
        <textarea name="search" placeholder="给 DeepSeek 发送消息 "></textarea>
      </div>
    `
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[name="search"]')!

    await createDeepSeekAdapter().fillAndSend('第一行\r\n第二行\r第三行', false)

    expect(editor.value).toBe('第一行\n第二行\n第三行')
  })

  it('clicks the enabled DeepSeek send button near the composer', async () => {
    document.body.innerHTML = `
      <div class="aaff8b8f">
        <textarea name="search" placeholder="给 DeepSeek 发送消息 "></textarea>
        <div class="ec4f5d61">
          <div role="button" aria-disabled="false" class="ds-toggle-button">深度思考</div>
          <div class="bf38813a">
            <div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule">
              <div class="ds-button__icon">
                <div class="ds-icon"></div>
              </div>
            </div>
            <input type="file" />
            <div>
              <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle _52c986b" tabindex="0">
                <div class="ds-button__icon">
                  <svg viewBox="0 0 16 16"></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    const buttons = [...document.querySelectorAll<HTMLElement>('.bf38813a [role="button"]')]
    const attachListener = vi.fn()
    const sendListener = vi.fn()
    buttons[0]?.addEventListener('click', attachListener)
    buttons[1]?.addEventListener('click', sendListener)

    await createDeepSeekAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(attachListener).not.toHaveBeenCalled()
    expect(sendListener).toHaveBeenCalledTimes(1)
  })

  it('clicks the DeepSeek send icon when hashed composer classes change', async () => {
    document.body.innerHTML = `
      <div class="new-composer-shell">
        <textarea name="search" placeholder="给 DeepSeek 发送消息 "></textarea>
        <div class="new-composer-actions">
          <div role="button" aria-label="上传附件" class="ds-icon-button new-attach-button" tabindex="0">
            <div class="ds-icon"></div>
          </div>
          <div role="button" aria-disabled="false" class="ds-icon-button new-send-button" tabindex="0">
            <div class="ds-icon"></div>
          </div>
        </div>
      </div>
    `
    const attachButton = document.querySelector<HTMLElement>('.new-attach-button')!
    const sendButton = document.querySelector<HTMLElement>('.new-send-button')!
    const attachListener = vi.fn()
    const sendListener = vi.fn()
    attachButton.addEventListener('click', attachListener)
    sendButton.addEventListener('click', sendListener)

    await createDeepSeekAdapter({ inputTimeoutMs: 50 }).fillAndSend('hello', true)

    expect(attachListener).not.toHaveBeenCalled()
    expect(sendListener).toHaveBeenCalledTimes(1)
  })

  it('reads only final assistant markdown replies and skips thinking content', () => {
    document.body.innerHTML = `
      <div class="_4f9bf79 d7dc56a8 _43c05b" data-virtual-list-item-key="2">
        <div class="ds-message _63c77b1">
          <div class="_74c0879">
            <div class="e1675d8b ds-think-content _767406f">
              <div class="ds-markdown"><p>内部思考</p></div>
            </div>
          </div>
          <div class="ds-markdown">
            <p class="ds-markdown-paragraph"><span>你好！很高兴见到你。</span></p>
          </div>
        </div>
      </div>
    `

    expect(createDeepSeekAdapter().getAllAssistantReplies()).toEqual(['你好！很高兴见到你。'])
  })

  it('converts DeepSeek reply DOM to markdown', () => {
    document.body.innerHTML = `
      <div class="_4f9bf79" data-virtual-list-item-key="2">
        <div class="ds-message">
          <div class="ds-markdown">
            <h2>方案</h2>
            <p><strong>结论</strong>：可以做</p>
            <ul><li>先接入 adapter</li><li>再验证 iframe</li></ul>
          </div>
        </div>
      </div>
    `
    const response = document.querySelector('.ds-markdown')!

    expect(createDeepSeekAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以做\n\n- 先接入 adapter\n- 再验证 iframe')
  })
})
