import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ExternalModelConfig, ExternalModelFormat } from '../group/types'

export class ExternalModelError extends Error {
  constructor(public message: string, public status?: number, public code?: string) {
    super(message)
    this.name = 'ExternalModelError'
  }

  get friendlyMessage(): string {
    if (this.status === 401 || this.status === 403) return 'API Key 无效或权限不足，请检查配置'
    if (this.status === 429) return '请求过于频繁，请稍后再试 (Rate Limit)'
    if (this.status === 404) return '模型名称不正确或端点路径错误'
    if (this.status && this.status >= 500) return '模型服务器出现内部错误，请稍后重试'
    if (this.message.includes('timeout') || this.message.includes('Network')) return '网络连接超时，请检查 BaseURL 和网络设置'
    return this.message
  }
}

export interface ExternalModelCompletionInput {
  model: ExternalModelConfig
  prompt: string
  abortSignal?: AbortSignal
}

export interface ExternalModelCompletionResult {
  content: string
}

export interface ExternalModelClient {
  stream?(input: ExternalModelCompletionInput): AsyncIterable<string>
  complete(input: ExternalModelCompletionInput): Promise<ExternalModelCompletionResult>
}

export interface ExternalModelClientOptions {
  timeoutMs?: number
}

const DEFAULT_EXTERNAL_MODEL_TIMEOUT_MS = 30000

export function normalizeBaseUrl(url: string, format: ExternalModelFormat): string {
  let normalized = url.trim().replace(/\/+$/, '')
  if (format === 'openai') {
    normalized = normalizeOpenAiCompatibleBaseUrl(normalized)
    if (!normalized.endsWith('/v1')) {
      normalized += '/v1'
    }
  }
  return normalized
}

function normalizeOpenAiCompatibleBaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname === 'dashscope.aliyuncs.com' ||
      parsed.hostname === 'dashscope-intl.aliyuncs.com'
    ) {
      const path = parsed.pathname.replace(/\/+$/, '')
      if (!path || path === '/') parsed.pathname = '/compatible-mode'
      if (path === '/compatible-mode') parsed.pathname = '/compatible-mode'
      return parsed.href.replace(/\/+$/, '')
    }
  } catch {
    // Preserve existing free-form handling for local or custom provider URLs.
  }
  return url
}

export function createExternalModelClient(fetchImpl: typeof fetch = fetch, options: ExternalModelClientOptions = {}): ExternalModelClient {
  let lastResponseMetadata: Record<string, unknown> = {}
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTERNAL_MODEL_TIMEOUT_MS

  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImpl(input, init)
    lastResponseMetadata = {
      url: input instanceof Request ? input.url : String(input),
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    }
    return response
  }

  return {
    stream(input) {
      return streamExternalModelWithTimeout(input, wrappedFetch, timeoutMs)
    },
    async complete(input) {
      const timeout = createTimedAbortSignal(input.abortSignal, timeoutMs)

      try {
        let content = ''
        const normalizedUrl = normalizeBaseUrl(input.model.baseUrl, input.model.format)
        const stream = streamExternalModel({ ...input, abortSignal: timeout.signal }, wrappedFetch)
        for await (const chunk of stream) content += chunk
        if (!content.trim()) {
          throw new ExternalModelError(
            `外部模型返回内容为空 (URL: ${normalizedUrl}, Model: ${input.model.modelName}, Response: ${JSON.stringify(lastResponseMetadata)})`
          )
        }
        return { content }
      } catch (error: any) {
        if (isAbortError(error)) {
          if (!timeout.timedOut()) throw error
          throw new ExternalModelError('请求超时，模型响应时间过长', 408)
        }
        if (error instanceof ExternalModelError) throw error
        throw new ExternalModelError(error.message || '未知外部模型错误')
      } finally {
        timeout.clear()
      }
    },
  }
}

async function* streamExternalModelWithTimeout(input: ExternalModelCompletionInput, fetchImpl: typeof fetch, timeoutMs: number): AsyncIterable<string> {
  const timeout = createTimedAbortSignal(input.abortSignal, timeoutMs)
  try {
    yield* streamExternalModel({ ...input, abortSignal: timeout.signal }, fetchImpl)
  } catch (error: any) {
    if (isAbortError(error)) {
      if (!timeout.timedOut()) throw error
      throw new ExternalModelError('请求超时，模型响应时间过长', 408)
    }
    if (error instanceof ExternalModelError) throw error
    throw new ExternalModelError(error.message || '未知外部模型错误')
  } finally {
    timeout.clear()
  }
}

function createTimedAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; clear(): void; timedOut(): boolean } {
  const controller = new AbortController()
  let didTimeout = false
  const timeoutId = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)
  const abortFromParent = () => controller.abort()

  if (parentSignal?.aborted) {
    abortFromParent()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
    timedOut() {
      return didTimeout
    },
  }
}

async function* streamExternalModel(input: ExternalModelCompletionInput, fetchImpl: typeof fetch): AsyncIterable<string> {
  const maxRetries = 3
  let attempt = 0

  while (true) {
    try {
      const normalizedUrl = normalizeBaseUrl(input.model.baseUrl, input.model.format)
      const provider = input.model.format === 'anthropic'
        ? createAnthropic({
          apiKey: input.model.apiKey,
          baseURL: normalizedUrl,
          fetch: fetchImpl,
        })
        : createOpenAICompatible({
          name: `openteam-${input.model.id}`,
          apiKey: input.model.apiKey,
          baseURL: normalizedUrl,
          fetch: fetchImpl,
        })

      const result = streamText({
        model: provider(input.model.modelName as never),
        prompt: input.prompt,
        abortSignal: input.abortSignal,
      })

      for await (const textPart of result.textStream) {
        if (textPart) yield textPart
      }
      return
    } catch (error: any) {
      if (isAbortError(error)) throw error
      attempt++
      const status = error.status || error.response?.status
      const isRetryable = status === 429 || (status >= 500 && status <= 599) || error.message?.includes('timeout') || error.message?.includes('Network')

      if (!isRetryable || attempt >= maxRetries) {
        throw new ExternalModelError(
          error.message || '外部模型请求失败',
          status,
          error.code
        )
      }

      const delay = Math.pow(2, attempt) * 500
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
