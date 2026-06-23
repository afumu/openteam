import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { findClickableCopyButton, readResponseTextFromCopyAction } from './clipboardCopy'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForElement } from './waitForElement'

const QWEN_HOST = 'chat.qwen.ai'
const QWEN_ORIGIN = `https://${QWEN_HOST}`
const QWEN_HOME_URL = `${QWEN_ORIGIN}/`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_CLIPBOARD_TIMEOUT_MS = 900
const DEFAULT_CLIPBOARD_POLL_MS = 40

const QWEN_SELECTORS = {
  editor: 'textarea.message-input-textarea',
  response: '.qwen-chat-message-assistant',
  copyButton:
    'button[aria-label*="复制"], button[aria-label*="Copy"], div[class*="copy"] button, span[class*="copy"] button, button.copy-response-button',
  turn: '.qwen-chat-message-assistant',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG', 'svg', 'PATH', 'path'])

interface QwenAdapterOptions {
  href?: string
  inputTimeoutMs?: number
  clipboardTimeoutMs?: number
  clipboardPollMs?: number
}

export function createQwenAdapter(options: QwenAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS
  const clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const clipboardPollMs = options.clipboardPollMs ?? DEFAULT_CLIPBOARD_POLL_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getQwenConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(QWEN_SELECTORS.response)].filter(isLikelyAssistantResponse)
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(stripNonContentElements(container))).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForElement(QWEN_SELECTORS.editor, inputTimeoutMs)
    if (!(editor instanceof HTMLTextAreaElement)) {
      throw new Error('Qwen editor is not a textarea')
    }

    setTextareaText(editor, content)
    if (editor.value.trim() !== content.trim()) {
      throw new Error('Qwen editor did not accept the prompt text')
    }

    if (!autoSend) return

    // Wait briefly for React to process the input and enable the send button
    await new Promise(resolve => window.setTimeout(resolve, 100))

    try {
      const sendButton = await waitForQwenSendButton(inputTimeoutMs)
      clickSendButton(sendButton)
    } catch {
      // Fallback: try keyboard submit
      if (!tryKeyboardSubmit(editor)) throw new Error('Qwen 发送按钮暂不可用，请稍后重试')
    }
  }

  return {
    id: 'qwen',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: node => extractCleanText(stripNonContentElements(node)),
    readResponseTextFromCopy: node => readResponseTextFromCopy(node, clipboardTimeoutMs, clipboardPollMs),
    readResponseMarkdown: node => extractMarkdownFromDom(stripNonContentElements(node)),
    findResponseContainer,
    isGenerating: isQwenGenerating,
    stopGenerating: stopQwenGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getQwenConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeQwenUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeQwenUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(QWEN_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === QWEN_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/(?:c|chat|s)\/([^/?#]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function setTextareaText(textarea: HTMLTextAreaElement, content: string): void {
  textarea.focus()
  // Use native value setter so React picks up the change
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')
  if (descriptor?.set) descriptor.set.call(textarea, content)
  else textarea.value = content
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

async function waitForQwenSendButton(timeoutMs: number): Promise<HTMLElement> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findQwenSendButton()
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }

  throw new Error('Qwen 发送按钮暂不可用，请稍后重试')
}

function findQwenSendButton(): HTMLElement | undefined {
  const sendBtn = document.querySelector<HTMLElement>('.message-input-right-button-send button.send-button')
  if (sendBtn && isUsableSendButton(sendBtn)) return sendBtn
  return undefined
}

function clickSendButton(element: HTMLElement): void {
  element.click()
}

function isUsableSendButton(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (/\bjsdom\b/i.test(window.navigator.userAgent)) return true
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(QWEN_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll('.message-input-right-button-send')].slice(0, 3).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('button')].slice(0, 12).map(describeElement),
  }
}

function stripNonContentElements(node: Node): Node {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element) return node
  const clone = element.cloneNode(true) as Element
  for (const el of clone.querySelectorAll('[class*="tool-status-card"], .message-hoc-container')) {
    el.remove()
  }
  // Remove hyperlinks — Qwen reference citations are meaningless in plain text
  for (const el of clone.querySelectorAll('a, .qwen-markdown-citation')) {
    el.remove()
  }
  // When the response content has fully rendered, extract only from it
  const responseContent = clone.querySelector('.response-message-content')
  if (responseContent) return responseContent
  return clone
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  const response = findClosestMatchingAncestor(element, QWEN_SELECTORS.response)
  return response && isLikelyAssistantResponse(response) ? response : null
}

async function readResponseTextFromCopy(node: Node, timeoutMs: number, pollMs: number): Promise<string | undefined> {
  return readResponseTextFromCopyAction({ node, timeoutMs, pollMs, findCopyButton })
}

function findCopyButton(response: Element): HTMLButtonElement | undefined {
  return findClickableCopyButton(response.closest(QWEN_SELECTORS.turn) ?? response.parentElement, QWEN_SELECTORS.copyButton)
}

function isLikelyAssistantResponse(element: Element): boolean {
  if (element.closest('form, textarea, [contenteditable="true"]')) return false
  if (element.closest('.message-input, .message-input-container, .message-input-container-area')) return false
  return extractCleanText(stripNonContentElements(element)).length > 0
}

function isQwenGenerating(): boolean {
  return Boolean(findQwenStopButton())
}

async function stopQwenGenerating(): Promise<boolean> {
  const button = findQwenStopButton()
  if (!button) return false
  button.click()
  return true
}

function findQwenStopButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableButton(button))
}

function tryKeyboardSubmit(editor: HTMLElement): boolean {
  editor.focus()
  return dispatchEnter(editor) || dispatchEnter(editor, { metaKey: true })
}

function dispatchEnter(editor: HTMLElement, options: { metaKey?: boolean } = {}): boolean {
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    metaKey: options.metaKey ?? false,
  }

  editor.dispatchEvent(new KeyboardEvent('keydown', eventOptions))
  editor.dispatchEvent(new KeyboardEvent('keypress', eventOptions))
  editor.dispatchEvent(new KeyboardEvent('keyup', eventOptions))
  return true
}
