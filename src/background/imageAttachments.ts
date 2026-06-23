import type { MessageImageAttachment, ReplyImageSource } from '../group/types'
import type { ImageAttachmentBlobRecord, ImageAttachmentRepository } from '../shared/imageAttachmentRepository'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const CHATGPT_IMAGE_SOURCE_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])
const OPENAI_IMAGE_HOST_SUFFIXES = ['.chatgpt.com', '.openai.com', '.oaiusercontent.com']
const GEMINI_IMAGE_SOURCE_HOSTS = new Set(['gemini.google.com'])
const GOOGLE_IMAGE_HOST_SUFFIXES = ['.googleusercontent.com']
const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type { ImageAttachmentBlobRecord, ImageAttachmentRepository } from '../shared/imageAttachmentRepository'

export interface ImageAttachmentService {
  captureReplyImages(input: {
    chatId: string
    messageId: string
    images: ReplyImageSource[]
  }): Promise<MessageImageAttachment[]>
  deleteByIds(ids: string[]): Promise<void>
}

export function createImageAttachmentService(deps: {
  fetchImage(url: string, init: RequestInit): Promise<Response>
  repository: ImageAttachmentRepository
  newId(): string
  now(): number
  maxImageBytes?: number
}): ImageAttachmentService {
  const maxImageBytes = deps.maxImageBytes ?? MAX_IMAGE_BYTES

  return {
    async captureReplyImages(input): Promise<MessageImageAttachment[]> {
      const uniqueImages = deduplicateImages(input.images)
      const attachments: MessageImageAttachment[] = []
      for (const [index, image] of uniqueImages.entries()) {
        attachments.push(await captureImage(image, index))
      }
      return attachments

      async function captureImage(image: ReplyImageSource, index: number): Promise<MessageImageAttachment> {
        const id = deps.newId()
        const shared = {
          id,
          type: 'image' as const,
          ...normalizeImagePresentation(image),
        }

        try {
          const source = requireSafeImageSourceUrl(image.sourceUrl)
          const response = await deps.fetchImage(source.href, {
            method: 'GET',
            credentials: 'include',
            redirect: 'follow',
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`)
          if (response.url) requireSafeImageRedirectUrl(response.url, source.provider)

          const mimeType = normalizeImageMimeType(response.headers.get('content-type'))
          if (!mimeType) throw new Error('远端内容不是图片')
          const declaredSize = readContentLength(response.headers.get('content-length'))
          if (declaredSize !== undefined && declaredSize > maxImageBytes) throw new Error('图片超过 25 MB 上限')

          const blob = await response.blob()
          if (blob.size > maxImageBytes) throw new Error('图片超过 25 MB 上限')
          const normalizedBlob = blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType)
          const fileName = `${source.provider}-image-${index + 1}.${extensionForMimeType(mimeType)}`
          const record: ImageAttachmentBlobRecord = {
            id,
            chatId: input.chatId,
            messageId: input.messageId,
            blob: normalizedBlob,
            mimeType,
            size: normalizedBlob.size,
            fileName,
            createdAt: deps.now(),
          }
          await deps.repository.put(record)

          return {
            ...shared,
            status: 'ready',
            mimeType,
            size: normalizedBlob.size,
            fileName,
          }
        } catch (error) {
          return {
            ...shared,
            status: 'error',
            error: safeCaptureError(error),
          }
        }
      }
    },
    deleteByIds(ids): Promise<void> {
      return deps.repository.deleteByIds(ids)
    },
  }
}

function deduplicateImages(images: ReplyImageSource[]): ReplyImageSource[] {
  const byUrl = new Map<string, ReplyImageSource>()
  for (const image of images) {
    const sourceUrl = image.sourceUrl.trim()
    if (!sourceUrl) continue
    const current = byUrl.get(sourceUrl)
    byUrl.set(sourceUrl, {
      sourceUrl,
      alt: current?.alt ?? image.alt,
      width: current?.width ?? image.width,
      height: current?.height ?? image.height,
    })
  }
  return [...byUrl.values()]
}

type ImageSourceProvider = 'chatgpt' | 'gemini'

function requireSafeImageSourceUrl(value: string): { href: string; provider: ImageSourceProvider } {
  const url = parseHttpsUrl(value)
  if (!url) throw new Error('不支持的图片来源')
  if (CHATGPT_IMAGE_SOURCE_HOSTS.has(url.hostname)) return { href: url.href, provider: 'chatgpt' }
  if (GEMINI_IMAGE_SOURCE_HOSTS.has(url.hostname) || isGoogleImageHost(url.hostname)) return { href: url.href, provider: 'gemini' }
  throw new Error('不支持的图片来源')
}

function requireSafeImageRedirectUrl(value: string, provider: ImageSourceProvider): string {
  const url = parseHttpsUrl(value)
  if (!url) throw new Error('图片重定向到了不受信任的站点')
  if (provider === 'chatgpt' && !isOpenAiImageHost(url.hostname)) throw new Error('图片重定向到了不受信任的站点')
  if (provider === 'gemini' && !isGeminiImageHost(url.hostname)) throw new Error('图片重定向到了不受信任的站点')
  return url.href
}

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

function isOpenAiImageHost(hostname: string): boolean {
  return CHATGPT_IMAGE_SOURCE_HOSTS.has(hostname) ||
    hostname === 'openai.com' ||
    hostname === 'oaiusercontent.com' ||
    OPENAI_IMAGE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
}

function isGeminiImageHost(hostname: string): boolean {
  return GEMINI_IMAGE_SOURCE_HOSTS.has(hostname) || isGoogleImageHost(hostname)
}

function isGoogleImageHost(hostname: string): boolean {
  return hostname === 'googleusercontent.com' || GOOGLE_IMAGE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
}

function normalizeImageMimeType(value: string | null): string | undefined {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase()
  return mimeType && SAFE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : undefined
}

function readContentLength(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/avif') return 'avif'
  return 'png'
}

function normalizeImagePresentation(image: ReplyImageSource): Pick<MessageImageAttachment, 'alt' | 'width' | 'height'> {
  const alt = image.alt?.trim().slice(0, 500)
  const width = normalizeDimension(image.width)
  const height = normalizeDimension(image.height)
  return {
    ...(alt ? { alt } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
}

function normalizeDimension(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : undefined
}

function safeCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === '不支持的图片来源' || message === '远端内容不是图片') return message
  if (message.includes('25 MB')) return '图片超过 25 MB 上限'
  if (message.includes('HTTP')) return message
  if (message.includes('重定向')) return message
  return '图片获取失败'
}
