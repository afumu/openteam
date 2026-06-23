import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExternalModelClient, ExternalModelError, normalizeBaseUrl } from './externalModelClient'
import type { ExternalModelConfig } from '../group/types'
import { streamText } from 'ai'

vi.mock('ai', () => ({
  streamText: vi.fn(),
}))

describe('ExternalModelClient Stability Baseline', () => {
  const mockConfig: ExternalModelConfig = {
    id: 'test-model',
    name: 'Test Model',
    format: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '***',
    modelName: 'gpt-4',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  let mockFetch: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createMockStreamResult(texts: string[]) {
    return {
      textStream: {
        async *[Symbol.asyncIterator]() {
          for (const text of texts) {
            yield text
          }
        },
      },
      content: '',
      text: '',
      reasoning: '',
      reasoningText: '',
    } as any
  }

  it('normalizes DashScope root URLs to the OpenAI-compatible endpoint', () => {
    expect(normalizeBaseUrl('https://dashscope.aliyuncs.com', 'openai')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(normalizeBaseUrl('https://dashscope-intl.aliyuncs.com/compatible-mode', 'openai')).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  })

  it('should succeed when the API returns a valid stream', async () => {
    vi.mocked(streamText).mockReturnValue(createMockStreamResult(['Hello', ' World']))

    const client = createExternalModelClient(mockFetch)
    const result = await client.complete({ model: mockConfig, prompt: 'Hi' })

    expect(result.content).toBe('Hello World')
  })

  it('should retry on 429 and eventually succeed', async () => {
    let callCount = 0
    vi.mocked(streamText).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const error: any = new Error('Too Many Requests')
        error.status = 429
        throw error
      }
      return createMockStreamResult(['Success after retry'])
    })

    const client = createExternalModelClient(mockFetch)
    const result = await client.complete({ model: mockConfig, prompt: 'Hi' })

    expect(callCount).toBe(2)
    expect(result.content).toBe('Success after retry')
  }, 10000)

  it('should fail after max retries on persistent 500 error', async () => {
    let callCount = 0
    vi.mocked(streamText).mockImplementation(() => {
      callCount++
      const error: any = new Error('Internal Server Error')
      error.status = 500
      throw error
    })

    const client = createExternalModelClient(mockFetch)

    await expect(client.complete({ model: mockConfig, prompt: 'Hi' }))
      .rejects.toThrow(ExternalModelError)

    expect(callCount).toBe(3)
  }, 10000)

  it('should fail immediately on non-retryable error (e.g. 400)', async () => {
    vi.mocked(streamText).mockImplementation(() => {
      const error: any = new Error('Bad Request')
      error.status = 400
      throw error
    })

    const client = createExternalModelClient(mockFetch)

    await expect(client.complete({ model: mockConfig, prompt: 'Hi' }))
      .rejects.toThrow(ExternalModelError)

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1)
  })

  it('times out complete calls when the provider stream never yields', async () => {
    vi.useFakeTimers()
    vi.mocked(streamText).mockImplementation(({ abortSignal }: any) => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((_, reject) => {
            abortSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        },
      },
    }) as any)

    const client = createExternalModelClient(mockFetch, { timeoutMs: 20 })
    let rejection: unknown
    const completion = client.complete({ model: mockConfig, prompt: 'Hi' }).catch(error => {
      rejection = error
    })

    await vi.advanceTimersByTimeAsync(21)
    await Promise.resolve()

    expect(rejection).toBeInstanceOf(ExternalModelError)
    expect((rejection as ExternalModelError).status).toBe(408)
    await completion
  })

  it('times out streaming chat calls when no token arrives', async () => {
    vi.useFakeTimers()
    vi.mocked(streamText).mockImplementation(({ abortSignal }: any) => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((_, reject) => {
            abortSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        },
      },
    }) as any)

    const client = createExternalModelClient(mockFetch, { timeoutMs: 20 })
    const iterator = client.stream!({ model: mockConfig, prompt: 'Hi' })[Symbol.asyncIterator]()
    let rejection: unknown
    const next = iterator.next().catch(error => {
      rejection = error
    })

    await vi.advanceTimersByTimeAsync(21)
    await Promise.resolve()

    expect(rejection).toBeInstanceOf(ExternalModelError)
    expect((rejection as ExternalModelError).status).toBe(408)
    await next
  })
})
