import type { ReplyImageSource } from '../../group/types'
import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { readResponseTextFromCopyAction, findClickableCopyButton } from './clipboardCopy'
import { readEditorText, setContentEditableText } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForClickableButton, waitForElement } from './waitForElement'

const GEMINI_ORIGIN = 'https://gemini.google.com'
const GEMINI_HOME_URL = `${GEMINI_ORIGIN}/`
const GEMINI_APP_PREFIX = '/app/'
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_CLIPBOARD_TIMEOUT_MS = 900
const DEFAULT_CLIPBOARD_POLL_MS = 40

const GEMINI_SELECTORS = {
  editor: 'div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"]',
  sendButton:
    'button.send-button[aria-label*="发送"], button.send-button[aria-label*="Send"], button[aria-label*="Send message"], button[aria-label*="发送消息"]',
  response: 'model-response, .model-response-text, message-content',
  copyButton:
    'button[data-test-id="copy-button"], copy-button button, button[mattooltip="复制回答"], button[aria-label="复制"], button[aria-label*="Copy"], button[aria-label*="复制"]',
  turn: 'model-response',
  image: 'img[src]',
}

const SKIP_TAGS = new Set([
  'MAT-ICON',
  'SCRIPT',
  'STYLE',
  'BUTTON',
  'MS-THOUGHT-CHUNK',
  'MAT-EXPANSION-PANEL-HEADER',
])

interface GeminiAdapterOptions {
  href?: string
  inputTimeoutMs?: number
  clipboardTimeoutMs?: number
  clipboardPollMs?: number
}

export function createGeminiAdapter(options: GeminiAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS
  const clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const clipboardPollMs = options.clipboardPollMs ?? DEFAULT_CLIPBOARD_POLL_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getGeminiConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(GEMINI_SELECTORS.response)]
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForElement(GEMINI_SELECTORS.editor, inputTimeoutMs)

    setContentEditableText(editor, content)
    if (readEditorText(editor) !== content.trim()) {
      throw new Error('Gemini editor did not accept the prompt text')
    }

    if (!autoSend) return

    try {
      const sendButton = await waitForClickableButton(GEMINI_SELECTORS.sendButton, inputTimeoutMs, 'Gemini 发送按钮暂不可用，请稍后重试')
      sendButton.click()
    } catch (error) {
      if (!tryKeyboardSubmit(editor)) throw error
    }
  }

  return {
    id: 'gemini',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseImages: extractResponseImages,
    readResponseTextFromCopy: node => readResponseTextFromCopy(node, clipboardTimeoutMs, clipboardPollMs),
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isGeminiGenerating,
    stopGenerating: stopGeminiGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getGeminiConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeGeminiUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeGeminiUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(GEMINI_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'gemini.google.com' ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  if (!url.pathname.startsWith(GEMINI_APP_PREFIX)) return undefined

  const conversationId = url.pathname.slice(GEMINI_APP_PREFIX.length).split('/')[0]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(GEMINI_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(GEMINI_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  return findClosestMatchingAncestor(element, GEMINI_SELECTORS.response)
}

function extractResponseImages(node: Node): ReplyImageSource[] {
  const scope = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!scope) return []

  const bySourceUrl = new Map<string, ReplyImageSource>()
  for (const image of scope.querySelectorAll<HTMLImageElement>(GEMINI_SELECTORS.image)) {
    if (image.closest('button, [role="button"], message-actions')) continue

    const sourceUrl = normalizeGeneratedImageUrl(image.currentSrc || image.src)
    if (!sourceUrl) continue

    bySourceUrl.set(sourceUrl, {
      sourceUrl,
      ...(image.alt.trim() ? { alt: image.alt.trim() } : {}),
      ...readImageDimensions(image),
    })
  }
  return [...bySourceUrl.values()]
}

function normalizeGeneratedImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value, location.href)
    if (url.protocol !== 'https:' || !isGoogleusercontentHost(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function isGoogleusercontentHost(hostname: string): boolean {
  return hostname === 'googleusercontent.com' || hostname.endsWith('.googleusercontent.com')
}

function readImageDimensions(image: HTMLImageElement): Pick<ReplyImageSource, 'width' | 'height'> {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return {
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
  }
}

async function readResponseTextFromCopy(node: Node, timeoutMs: number, pollMs: number): Promise<string | undefined> {
  return readResponseTextFromCopyAction({ node, timeoutMs, pollMs, findCopyButton })
}

function findCopyButton(response: Element): HTMLButtonElement | undefined {
  const turn = response.closest(GEMINI_SELECTORS.turn) ?? response.parentElement
  return findClickableCopyButton(turn, GEMINI_SELECTORS.copyButton)
}

function isGeminiGenerating(): boolean {
  return Boolean(findGeminiStopButton())
}

async function stopGeminiGenerating(): Promise<boolean> {
  const button = findGeminiStopButton()
  if (!button) return false
  button.click()
  return true
}

function findGeminiStopButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableButton(button))
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
