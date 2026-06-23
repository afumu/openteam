import type { ChatSite } from './types'

const GEMINI_ORIGIN = 'https://gemini.google.com'
const GEMINI_HOME_URL = `${GEMINI_ORIGIN}/`
const GEMINI_APP_PREFIX = '/app/'
const CHATGPT_ORIGIN = 'https://chatgpt.com'
const CHATGPT_HOME_URL = 'https://chatgpt.com/'
const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])
const CLAUDE_ORIGIN = 'https://claude.ai'
const CLAUDE_HOME_URL = 'https://claude.ai/new'
const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com'
const DEEPSEEK_HOME_URL = `${DEEPSEEK_ORIGIN}/`
const GROK_ORIGIN = 'https://grok.com'
const GROK_HOME_URL = `${GROK_ORIGIN}/`
const QWEN_ORIGIN = 'https://chat.qwen.ai'
const QWEN_HOME_URL = `${QWEN_ORIGIN}/`

interface ChatSiteStartUrlRole {
  chatSite?: ChatSite
  chatGptGptsUrl?: string
  grokProjectUrl?: string
}

export function isSafeGeminiUrl(value: string | undefined): value is string {
  if (!value || !value.startsWith(GEMINI_HOME_URL)) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'gemini.google.com'
  } catch {
    return false
  }
}

export function getSafeGeminiUrl(value: string | undefined): string {
  return isSafeGeminiUrl(value) ? value : GEMINI_HOME_URL
}

export function getSafeGeminiIframeSrc(value: string | undefined): string {
  return getSafeGeminiUrl(value)
}

export function isSafeSupportedChatUrl(value: string | undefined): value is string {
  return isSafeGeminiUrl(value) || isSafeChatGptUrl(value) || isSafeClaudeUrl(value) || isSafeDeepSeekUrl(value) || isSafeGrokUrl(value) || isSafeQwenUrl(value)
}

export function getSafeSupportedChatUrl(value: string | undefined): string {
  return isSafeSupportedChatUrl(value) ? value : GEMINI_HOME_URL
}

export function getSafeSupportedChatIframeSrc(value: string | undefined): string {
  return getSafeSupportedChatUrl(value)
}

export function getDefaultChatSiteUrl(site: ChatSite | undefined): string {
  if (site === 'chatgpt') return CHATGPT_HOME_URL
  if (site === 'claude') return CLAUDE_HOME_URL
  if (site === 'deepseek') return DEEPSEEK_HOME_URL
  if (site === 'grok') return GROK_HOME_URL
  if (site === 'qwen') return QWEN_HOME_URL
  return GEMINI_HOME_URL
}

export function getDefaultChatSiteUrlForRole(role: ChatSiteStartUrlRole, fallbackSite?: ChatSite): string {
  const site = role.chatSite ?? fallbackSite
  if (site === 'chatgpt') return normalizeChatGptGptsUrl(role.chatGptGptsUrl) ?? CHATGPT_HOME_URL
  if (site === 'grok') return normalizeGrokProjectUrl(role.grokProjectUrl) ?? GROK_HOME_URL
  return getDefaultChatSiteUrl(site)
}

export function getSafeSupportedChatIframeSrcForSite(value: string | undefined, site: ChatSite | undefined): string {
  return isSafeSupportedChatUrl(value) ? value : getDefaultChatSiteUrl(site)
}

export function getSafeSupportedChatIframeSrcForRole(value: string | undefined, role: ChatSiteStartUrlRole, fallbackSite?: ChatSite): string {
  return isSafeSupportedChatUrl(value) ? value : getDefaultChatSiteUrlForRole(role, fallbackSite)
}

export function normalizeSupportedChatConversationUrl(value: string | undefined): string | undefined {
  return isSafeSupportedChatUrl(value) ? new URL(value).href : undefined
}

export function normalizeChatGptGptsUrl(value: string | undefined): string | undefined {
  const url = parseSafeChatGptUrl(value)
  if (!url) return undefined

  const match = url.pathname.match(/^\/g\/([^/]+)/)
  const gptsSlug = match?.[1]
  return gptsSlug ? `${url.origin}/g/${gptsSlug}` : undefined
}

export function normalizeGrokProjectUrl(value: string | undefined): string | undefined {
  const url = parseSafeGrokUrl(value)
  if (!url) return undefined

  const projectId = url.pathname.match(/^\/project\/([^/]+)/)?.[1]
  return projectId ? `${url.origin}/project/${projectId}` : undefined
}

export function extractSupportedConversationId(value: string | undefined): string | undefined {
  return (
    extractGeminiConversationId(value) ??
    extractChatGptConversationId(value) ??
    extractClaudeConversationId(value) ??
    extractDeepSeekConversationId(value) ??
    extractGrokConversationId(value) ??
    extractQwenConversationId(value)
  )
}

export function getSupportedChatOrigin(value: string | undefined): string {
  if (!isSafeSupportedChatUrl(value)) return GEMINI_ORIGIN
  return new URL(value).origin
}

export function getSupportedChatOriginForSite(value: string | undefined, site: ChatSite | undefined): string {
  if (isSafeSupportedChatUrl(value)) return new URL(value).origin
  if (site === 'chatgpt') return CHATGPT_ORIGIN
  if (site === 'claude') return CLAUDE_ORIGIN
  if (site === 'deepseek') return DEEPSEEK_ORIGIN
  if (site === 'grok') return GROK_ORIGIN
  if (site === 'qwen') return QWEN_ORIGIN
  return GEMINI_ORIGIN
}

export function extractGeminiConversationId(value: string | undefined): string | undefined {
  if (!isSafeGeminiUrl(value)) return undefined

  const url = new URL(value)
  if (!url.pathname.startsWith(GEMINI_APP_PREFIX)) return undefined

  const conversationId = url.pathname.slice(GEMINI_APP_PREFIX.length).split('/')[0]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

export function normalizeGeminiConversationUrl(value: string | undefined): string | undefined {
  return isSafeGeminiUrl(value) ? new URL(value).href : undefined
}

function isSafeChatGptUrl(value: string | undefined): value is string {
  return Boolean(parseSafeChatGptUrl(value))
}

function extractChatGptConversationId(value: string | undefined): string | undefined {
  if (!isSafeChatGptUrl(value)) return undefined

  const url = new URL(value)
  const directConversationId = url.pathname.startsWith('/c/') ? url.pathname.slice('/c/'.length).split('/')[0] : undefined
  const gptsConversationId = url.pathname.match(/^\/g\/[^/]+\/c\/([^/]+)/)?.[1]
  const conversationId = directConversationId ?? gptsConversationId
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function parseSafeChatGptUrl(value: string | undefined): URL | undefined {
  if (!value || (!value.startsWith(CHATGPT_HOME_URL) && !value.startsWith('https://chat.openai.com/'))) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname) ? url : undefined
  } catch {
    return undefined
  }
}

function isSafeClaudeUrl(value: string | undefined): value is string {
  if (!value || !value.startsWith('https://claude.ai/')) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'claude.ai'
  } catch {
    return false
  }
}

function extractClaudeConversationId(value: string | undefined): string | undefined {
  if (!isSafeClaudeUrl(value)) return undefined

  const url = new URL(value)
  if (!url.pathname.startsWith('/chat/')) return undefined

  const conversationId = url.pathname.slice('/chat/'.length).split('/')[0]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function isSafeDeepSeekUrl(value: string | undefined): value is string {
  if (!value || !value.startsWith(DEEPSEEK_HOME_URL)) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.deepseek.com'
  } catch {
    return false
  }
}

function extractDeepSeekConversationId(value: string | undefined): string | undefined {
  if (!isSafeDeepSeekUrl(value)) return undefined

  const url = new URL(value)
  const match = url.pathname.match(/^\/a\/chat\/s\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}


function isSafeGrokUrl(value: string | undefined): value is string {
  return Boolean(parseSafeGrokUrl(value))
}

function parseSafeGrokUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(GROK_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'grok.com' ? url : undefined
  } catch {
    return undefined
  }
}

function extractGrokConversationId(value: string | undefined): string | undefined {
  if (!isSafeGrokUrl(value)) return undefined

  const url = new URL(value)
  const match = url.pathname.match(/^\/(?:chat|c)\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function isSafeQwenUrl(value: string | undefined): value is string {
  return Boolean(parseSafeQwenUrl(value))
}

function parseSafeQwenUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(QWEN_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.qwen.ai' ? url : undefined
  } catch {
    return undefined
  }
}

function extractQwenConversationId(value: string | undefined): string | undefined {
  if (!isSafeQwenUrl(value)) return undefined

  const url = new URL(value)
  const match = url.pathname.match(/^\/(?:c|chat|s)\/([^/?#]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}
