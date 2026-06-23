import { createChatGptAdapter } from './chatgpt'
import { createClaudeAdapter } from './claude'
import { createDeepSeekAdapter } from './deepseek'
import { createGeminiAdapter } from './gemini'
import { createGrokAdapter } from './grok'
import { createQwenAdapter } from './qwen'
import type { ChatSiteAdapter } from './types'

export function getActiveChatSiteAdapter(): ChatSiteAdapter {
  if (location.hostname === 'chat.qwen.ai') return createQwenAdapter()
  if (location.hostname === 'claude.ai') return createClaudeAdapter()
  if (location.hostname === 'chat.deepseek.com') return createDeepSeekAdapter()
  if (location.hostname === 'chatgpt.com' || location.hostname === 'chat.openai.com') return createChatGptAdapter()
  if (location.hostname === 'grok.com') return createGrokAdapter()
  return createGeminiAdapter()
}
