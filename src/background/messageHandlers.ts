import { extractSupportedConversationId, normalizeSupportedChatConversationUrl } from '../group/conversationUrl'
import { normalizeMessageHighlightColor } from '../group/highlightColors'
import { defaultMentionTargetForMessage, parseGroupMentions, roleMentionLabelOptionsFromSettings } from '../group/mentionParser'
import { mapRuntimeRoleStatus } from '../group/runtimeProtocol'
import type { BackgroundToRoleMessage } from '../group/runtimeProtocol'
import type { ChatSite, ExternalModelConfig, GroupChat, GroupMessage, GroupRole, MessageImageAttachment, MessageReference, OpenTeamStore, OrchestrationFlow, ReplyImageSource, RoleSiteHealthStatus, RuntimeFrameBinding } from '../group/types'
import { createExternalModelClient, type ExternalModelClient } from './externalModelClient'
import type { BackgroundMessageRoute } from './messageRouter'
import type { PromptDelivery, PromptSender } from './promptDelivery'
import { DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS, sendPromptDeliveryWithRetry } from './promptDeliveryRetry'
import { getExternalModelForRole, isExternalModelRole, prepareRolePromptDelivery, type ExternalPromptDelivery, type PreparedRolePromptDelivery } from './rolePromptDelivery'
import { messageTabId, rememberHost, senderFrameId, senderTabId, type RuntimeMessage } from './runtimeClient'
import type { RuntimeFrameRegistry } from './runtimeFrames'
import type { SitePromptDeliveryLimiter } from './sitePromptDeliveryLimiter'
import { getChatMessages, getChatRoles, mutateStore, requireChat, requireRole } from './storeAccess'
import { markOrchestrationRoleError, maybeAdvanceOrchestrationRun, startOrchestrationRun } from './orchestrationRuntime'

const STALE_THINKING_MS = 120_000
const DEFAULT_EXTERNAL_MODEL_RETRY_DELAYS_MS = [2_000, 2_000, 4_000, 8_000, 15_000] as const
const DEFAULT_ROLE_ERROR_RETRY_DELAYS_MS = [2_000, 8_000] as const

interface ExternalModelRunRegistry {
  register(chatId: string, roleId: string, replyAttemptId: string, controller: AbortController): void
  abort(chatId: string, roleId: string, replyAttemptId?: string): void
  unregister(chatId: string, roleId: string, replyAttemptId: string): void
}

export const MESSAGE_ROUTE_TYPES = [
  'GROUP_ROLE_RETRY_REPLY',
  'GROUP_ROLE_STOP_REPLY',
  'GROUP_NOTE_SAVE',
  'GROUP_MESSAGE_HIGHLIGHT_CREATE',
  'GROUP_MESSAGE_RESYNC_REPLY',
  'GROUP_MESSAGE_SEND',
  'TEAM_FRAME_ROLE_READY',
  'TEAM_ROLE_CONVERSATION_UPDATED',
  'TEAM_SEND_ACK',
  'TEAM_ROLE_STATUS',
  'TEAM_SITE_STATUS_UPDATE',
  'TEAM_ROLE_REPLY',
  'TEAM_ROLE_REPLY_RESYNC',
  'TEAM_ROLE_ERROR',
] as const

export interface MessageHandlersDependencies {
  broadcastStoreUpdated(store: OpenTeamStore, excludeTabId?: number): Promise<void> | void
  getChatStatusFromRoles(store: OpenTeamStore, chat: GroupChat): GroupChat['status']
  log: {
    debug(event: string, details?: Record<string, unknown>): void
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
  newId(prefix: string): string
  now(): number
  runtimeFrames: Pick<RuntimeFrameRegistry, 'bind' | 'getByAddress' | 'getByRole'>
  sendRoleMessage(tabId: number, frameId: number, message: BackgroundToRoleMessage): Promise<unknown>
  sendError(reason: string): Promise<void> | void
  sendPrompt: PromptSender
  promptDeliveryLimiter?: SitePromptDeliveryLimiter
  externalModelClient?: ExternalModelClient
  externalModelRuns?: ExternalModelRunRegistry
  imageAttachments?: {
    captureReplyImages(input: { chatId: string; messageId: string; images: ReplyImageSource[] }): Promise<MessageImageAttachment[]>
    deleteByIds(ids: string[]): Promise<void>
  }
  deliveryRetryDelaysMs?: readonly number[]
  externalModelRetryDelaysMs?: readonly number[]
  roleErrorRetryDelaysMs?: readonly number[]
  requestRoleRecovery?(chatId: string, roleId: string, reason?: string): Promise<boolean>
  waitForRetry?(ms: number): Promise<void>
}

export function createMessageHandlers(deps: MessageHandlersDependencies): BackgroundMessageRoute[] {
  const externalModelClient = deps.externalModelClient ?? createExternalModelClient()
  const externalModelRuns = deps.externalModelRuns ?? createExternalModelRunRegistry()
  const roleErrorRetryCounts = new Map<string, number>()

  const handleMessageSend = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const raw = requireString(message.raw, '消息内容不能为空')
    const timestamp = deps.now()
    deps.log.info('message-send:start', { chatId, rawLength: raw.length })

    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const roles = getChatRoles(store, chat)
      const parsed = parseGroupMentions(raw, roles, { ...roleMentionLabelOptionsFromSettings(store.settings), defaultTarget: defaultMentionTargetForMessage(raw, chat) })
      if (!parsed.ok) throw new Error(parsed.error)

      if (parsed.orchestrationTarget) {
        const flow = resolveOrchestrationMentionFlow(store, chat, parsed.orchestrationTarget)
        return {
          orchestration: {
            chatId: chat.id,
            flowId: flow.id,
            task: parsed.content,
            maxRounds: flow.maxRounds,
            maxNodeExecutions: flow.maxNodeExecutions,
          },
        }
      }

      let finalTargetRoleIds = parsed.targetRoleIds
      const hasManualRoute = parsed.mentionedRoleIds.length > 0 || Boolean(parsed.mentionsAll) || Boolean(parsed.orchestrationTarget)
      if (chat.requireManualMention && !hasManualRoute) {
        finalTargetRoleIds = []
      }
      deps.log.debug('message-send:parsed-targets', { chatId: chat.id, targetRoleIds: finalTargetRoleIds })

      const targetRoles = finalTargetRoleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
      const unavailable = targetRoles.filter(role => {
        if (isExternalModelRole(role)) return !getExternalModelForRole(store, role)
        return !isRoleDeliverable(role, deps.runtimeFrames.getByRole(chat.id, role.id), timestamp)
      })
      const deliverableTargetRoles = targetRoles.filter(role => !unavailable.includes(role))

      if (unavailable.length > 0 && deliverableTargetRoles.length === 0) {
        deps.log.warn('message-send:unavailable-targets', {
          chatId: chat.id,
          targets: unavailable.map(role => ({
            id: role.id,
            name: role.name,
            status: role.status,
            updatedAt: role.updatedAt,
            staleThinking: isStaleThinkingRole(role, timestamp),
            binding: isExternalModelRole(role) ? undefined : deps.runtimeFrames.getByRole(chat.id, role.id),
          })),
        })
        throw new Error(`以下人员不可用，请等待或恢复：${unavailable.map(role => role.name).join('、')}`)
      }
      if (unavailable.length > 0) {
        deps.log.warn('message-send:partial-unavailable-targets', {
          chatId: chat.id,
          skippedTargets: unavailable.map(role => ({
            id: role.id,
            name: role.name,
            status: role.status,
            updatedAt: role.updatedAt,
            staleThinking: isStaleThinkingRole(role, timestamp),
            binding: isExternalModelRole(role) ? undefined : deps.runtimeFrames.getByRole(chat.id, role.id),
          })),
          deliverableTargetIds: deliverableTargetRoles.map(role => role.id),
        })
      }

      for (const role of deliverableTargetRoles) recoverDeliverableRoleStatus(role, timestamp, deps.log)

      const reference = resolveReference(store, chat, message.reference ?? (Array.isArray(message.references) ? message.references[0] : undefined), deps.newId)
      const userMessage: GroupMessage = {
        id: deps.newId('msg'),
        chatId: chat.id,
        seq: chat.nextMessageSeq,
        type: 'user',
        content: parsed.content,
        targetRoleIds: finalTargetRoleIds,
        mentionedRoleIds: parsed.mentionedRoleIds,
        mentionsAll: parsed.mentionsAll,
        references: reference ? [reference] : undefined,
        createdAt: timestamp,
        status: finalTargetRoleIds.length > 0 ? 'pending' : 'received',
        deliveryStatus: Object.fromEntries(finalTargetRoleIds.map(roleId => [roleId, unavailable.some(role => role.id === roleId) ? 'error' : 'pending'])),
      }
      updateUserMessageDeliveryStatus(userMessage)

      store.messagesById[userMessage.id] = userMessage
      chat.messageIds.push(userMessage.id)
      chat.nextMessageSeq += 1
      deps.log.info('message-send:stored', { chatId: chat.id, messageId: userMessage.id, targetCount: parsed.targetRoleIds.length })
      chat.updatedAt = timestamp
      if (finalTargetRoleIds.length === 0) {
        return { message: userMessage, deliveries: [], externalDeliveries: [] }
      }

      chat.status = 'running'

      const messages = getChatMessages(store, chat)
      const deliveries: PromptDelivery[] = []
      const externalDeliveries: ExternalPromptDelivery[] = []
      for (const role of deliverableTargetRoles) {
        const prepared = prepareRolePromptDelivery({ store, chat, role, userMessage, roles, messages, reference, timestamp, newId: deps.newId, runtimeFrames: deps.runtimeFrames })
        if (prepared.delivery) deliveries.push(prepared.delivery)
        if (prepared.externalDelivery) externalDeliveries.push(prepared.externalDelivery)
        if (!prepared.includesPersona && prepared.delivery) {
          deps.log.debug('prompt:persona-skipped', {
            chatId: chat.id,
            roleId: role.id,
            messageId: userMessage.id,
            conversationUrlPresent: Boolean(role.geminiConversationUrl),
            contextCursor: role.contextCursor,
            roleHistoryCount: prepared.roleHistoryCount,
            personaLength: readPersonaLength(role),
          })
        }

        role.status = 'thinking'
        role.lastPromptMessageId = userMessage.id
        role.replyAttemptId = prepared.replyAttemptId
        role.updatedAt = timestamp
      }
      for (const role of unavailable) {
        const keepActiveThinking = role.status === 'thinking' && !isStaleThinkingRole(role, timestamp)
        if (!keepActiveThinking) role.status = 'error'
        role.updatedAt = timestamp
        if (role.lastPromptMessageId === userMessage.id) delete role.lastPromptMessageId
        if (!keepActiveThinking) delete role.replyAttemptId
      }

      return { message: userMessage, deliveries, externalDeliveries }
    })

    const orchestration = 'orchestration' in result ? result.orchestration : undefined
    if (orchestration) {
      deps.log.info('message-send:orchestration-start', { chatId, flowId: orchestration.flowId, taskLength: orchestration.task.length })
      return { ok: true, ...(await startOrchestrationRun(deps, orchestration)) }
    }
    const messageResult = result as { message: GroupMessage; deliveries: PromptDelivery[]; externalDeliveries: ExternalPromptDelivery[] }

    deps.log.info('message-send:deliveries-ready', {
      chatId,
      messageId: messageResult.message.id,
      deliveries: [
        ...messageResult.deliveries.map(delivery => ({ roleId: delivery.roleId, modelSource: 'site', chatSite: delivery.chatSite, tabId: delivery.tabId, frameId: delivery.frameId, contentLength: delivery.message.content.length })),
        ...messageResult.externalDeliveries.map(delivery => ({ roleId: delivery.roleId, modelSource: 'external', modelId: delivery.model.id, contentLength: delivery.prompt.length })),
      ],
    })
    await deps.broadcastStoreUpdated(store)

    await sendPromptDeliveries(deps, chatId, messageResult.message.id, messageResult.deliveries)
    let responseStore = store
    for (const delivery of messageResult.externalDeliveries) {
      responseStore = await sendExternalModelDelivery(deps, externalModelClient, externalModelRuns, delivery) ?? responseStore
    }

    return {
      ok: true,
      message: messageResult.message,
      deliveries: [
        ...messageResult.deliveries.map(delivery => ({ roleId: delivery.roleId, modelSource: 'site' })),
        ...messageResult.externalDeliveries.map(delivery => ({ roleId: delivery.roleId, modelSource: 'external' })),
      ],
      store: responseStore,
    }
  }

  const handleRoleRetryReply = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const timestamp = deps.now()
    let discardedAttachmentIds: string[] = []

    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      const requestedMessageId = readOptionalString(message.messageId)
      const retryTarget = resolveRetryTarget(store, chat, role, requestedMessageId, deps.log)
      const userMessage = retryTarget?.userMessage
      if (!userMessage) throw new Error(requestedMessageId ? '该消息没有发送给这个人员' : '找不到可重试的用户消息')
      if (retryTarget?.discardMessageId) {
        discardedAttachmentIds = readyAttachmentIds(store.messagesById[retryTarget.discardMessageId]?.attachments)
        discardMessage(store, chat, retryTarget.discardMessageId)
      }

      const roles = getChatRoles(store, chat)
      const messages = getChatMessages(store, chat)
      const reference = userMessage.references?.[0]
      const prepared = prepareRolePromptDelivery({ store, chat, role, userMessage, roles, messages, reference, timestamp, newId: deps.newId, runtimeFrames: deps.runtimeFrames })

      userMessage.deliveryStatus ??= {}
      userMessage.deliveryStatus[role.id] = 'pending'
      userMessage.status = 'pending'
      role.status = 'thinking'
      role.lastPromptMessageId = userMessage.id
      role.replyAttemptId = prepared.replyAttemptId
      role.updatedAt = timestamp
      chat.status = 'running'
      chat.updatedAt = timestamp
      return prepared
    })

    await deleteAttachmentIdsBestEffort(deps, discardedAttachmentIds, 'role-retry-reply:attachment-cleanup-failed')
    await deps.broadcastStoreUpdated(store)
    const externalDelivery = 'externalDelivery' in result ? result.externalDelivery : undefined
    if (externalDelivery) {
      deps.log.info('role-retry-reply:deliver-external', {
        chatId,
        roleId,
        messageId: externalDelivery.messageId,
        replyAttemptId: externalDelivery.replyAttemptId,
        modelId: externalDelivery.model.id,
      })
      const responseStore = await sendExternalModelDelivery(deps, externalModelClient, externalModelRuns, externalDelivery) ?? store
      return { ok: true, store: responseStore, messageId: externalDelivery.messageId }
    }
    const delivery = 'delivery' in result ? result.delivery : undefined
    if (!delivery) throw new Error('重试投递生成失败')
    deps.log.info('role-retry-reply:deliver', {
      chatId,
      roleId,
      messageId: delivery.message.messageId,
      replyAttemptId: delivery.message.replyAttemptId,
      tabId: delivery.tabId,
      frameId: delivery.frameId,
    })
    await enqueuePromptDelivery(deps, chatId, delivery.message.messageId, delivery)
    return { ok: true, store, messageId: delivery.message.messageId }
  }

  const handleRoleStopReply = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')

    const { result: active } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      if (role.status !== 'thinking' || !role.lastPromptMessageId) throw new Error('该人员当前没有正在回复的任务')
      return {
        messageId: role.lastPromptMessageId,
        replyAttemptId: role.replyAttemptId,
        isExternal: isExternalModelRole(role),
      }
    })

    if (active.isExternal) {
      externalModelRuns.abort(chatId, roleId, active.replyAttemptId)
    } else {
      const binding = deps.runtimeFrames.getByRole(chatId, roleId)
      if (!binding?.ready) throw new Error('人员 iframe 尚未就绪，无法停止回复')
      try {
        const response = await deps.sendRoleMessage(binding.tabId, binding.frameId, {
          type: 'TEAM_STOP_GENERATION',
          chatId,
          roleId,
          messageId: active.messageId,
          replyAttemptId: active.replyAttemptId,
        })
        if (isRecord(response) && response.ok === false) throw new Error(readOptionalString(response.error) ?? '停止回复失败')
      } catch (error) {
        if (!isReceiverDisconnectedError(error)) throw error
        deps.log.warn('role-stop-reply:receiver-disconnected', {
          chatId,
          roleId,
          messageId: active.messageId,
          replyAttemptId: active.replyAttemptId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const timestamp = deps.now()
    const { store } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      if (role.lastPromptMessageId !== active.messageId) return
      const finalizedVisibleReply = active.isExternal ? finalizeActiveExternalAssistantReply(store, chat, role, active.messageId) : false
      if (!finalizedVisibleReply) {
        role.status = 'stopped'
        role.replyAttemptId = deps.newId('stopped')
      }
      role.updatedAt = timestamp
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = timestamp
    })
    deps.log.info('role-stop-reply:stopped', { chatId, roleId, messageId: active.messageId, modelSource: active.isExternal ? 'external' : 'site' })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, store, messageId: active.messageId }
  }

  const handleNoteSave = async (message: RuntimeMessage) => {
    const scope = readOptionalString(message.scope)
    if (scope !== 'global' && scope !== 'chat') throw new Error('未知笔记范围')
    const content = requireNoteContent(message.content)

    const { store } = await mutateStore(store => {
      if (scope === 'global') {
        store.globalNote = content
        return
      }

      const chatId = requireString(message.chatId, '缺少群聊 ID')
      requireChat(store, chatId)
      store.chatNotesById ??= {}
      store.chatNotesById[chatId] = content
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, store }
  }

  const handleMessageHighlightCreate = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const messageId = requireString(message.messageId, '缺少消息 ID')
    const text = requireString(message.text, '高亮内容不能为空')
    const startOffset = requireNumber(message.startOffset, '缺少高亮起点')
    const endOffset = requireNumber(message.endOffset, '缺少高亮终点')
    const color = normalizeMessageHighlightColor(message.color)
    if (endOffset <= startOffset) throw new Error('高亮范围无效')
    const timestamp = deps.now()

    const { store } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const target = store.messagesById[messageId]
      if (!target || target.chatId !== chat.id) throw new Error('找不到消息')
      if (startOffset < 0 || endOffset > target.content.length || target.content.slice(startOffset, endOffset) !== text) throw new Error('高亮范围与消息内容不匹配')

      store.messageHighlightsById ??= {}
      store.messageHighlightsById[messageId] ??= []
      store.messageHighlightsById[messageId].push({
        id: deps.newId('highlight'),
        messageId,
        text,
        startOffset,
        endOffset,
        color,
        createdAt: timestamp,
      })
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, store }
  }

  const handleMessageResyncReply = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const messageId = requireString(message.messageId, '缺少消息 ID')
    const binding = deps.runtimeFrames.getByRole(chatId, roleId)
    if (!binding?.ready) throw new Error('人员 iframe 尚未就绪，请先恢复人员')

    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      const assistantMessage = store.messagesById[messageId]
      if (!isAssistantMessageForRole(assistantMessage, chat, role)) throw new Error('该回复不属于这个人员')
      return { currentContent: assistantMessage.content }
    })

    deps.log.warn('message-resync-reply:request', { chatId, roleId, messageId, tabId: binding.tabId, frameId: binding.frameId, currentContentLength: result.currentContent.length })
    const response = await deps.sendRoleMessage(binding.tabId, binding.frameId, {
      type: 'TEAM_RESYNC_REPLY',
      chatId,
      roleId,
      messageId,
      currentContent: result.currentContent,
    })
    if (isRecord(response) && response.ok === false) throw new Error(readOptionalString(response.error) ?? '重新同步回复失败')
    if (isRecord(response) && isRecord(response.store)) {
      const updatedMessage = isRecord(response.message) ? response.message : undefined
      deps.log.warn('message-resync-reply:updated-store', {
        chatId,
        roleId,
        messageId,
        updatedContentLength: typeof updatedMessage?.content === 'string' ? updatedMessage.content.length : undefined,
      })
      return { ok: true, store: response.store as unknown as OpenTeamStore, message: response.message, messageId }
    }
    deps.log.warn('message-resync-reply:no-updated-store', { chatId, roleId, messageId, response })
    return { ok: true, store, messageId }
  }

  const handleFrameRoleReady = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const tabId = messageTabId(message, sender)
    if (tabId === undefined) throw new Error('缺少 sender tab')
    rememberHost(sender, tabId)

    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const frameId = senderFrameId(sender)
    const timestamp = deps.now()
    deps.log.info('frame-ready:received', {
      chatId,
      roleId,
      tabId,
      frameId,
      senderTabId: senderTabId(sender),
      hostTabId: message.hostTabId,
      senderUrl: sender.url,
      conversationId: message.conversationId,
      conversationUrl: message.conversationUrl,
    })
    deps.runtimeFrames.bind({ chatId, roleId, tabId, frameId, ready: true, lastSeenAt: timestamp })

    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      role.status = 'ready'
      role.updatedAt = timestamp
      updateConversation(role, readOptionalString(message.conversationUrl), readOptionalString(message.conversationId))
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = timestamp
      return { role, replyHistory: getRoleReplyHistory(store, chat, role.id) }
    })

    deps.log.info('frame-ready:store-updated', { chatId, roleId, roleName: result.role.name, status: result.role.status, replyHistoryCount: result.replyHistory.length, binding: deps.runtimeFrames.getByRole(chatId, roleId) })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result.role, replyHistory: result.replyHistory, store }
  }

  const handleConversationUpdated = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const identity = readIdentity(deps, message, sender)
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, identity.chatId)
      const role = requireRole(store, chat.id, identity.roleId)
      updateConversation(role, readOptionalString(message.conversationUrl), readOptionalString(message.conversationId))
      role.updatedAt = deps.now()
      chat.updatedAt = role.updatedAt
      return role
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleSendAck = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const identity = readIdentity(deps, message, sender)
    const messageId = requireString(message.messageId, '缺少消息 ID')
    deps.log.info('send-ack:received', { ...identity, messageId, senderUrl: sender.url, tabId: messageTabId(message, sender), frameId: senderFrameId(sender) })
    const { store } = await mutateStore(store => {
      const chat = requireChat(store, identity.chatId)
      const role = requireRole(store, chat.id, identity.roleId)
      const userMessage = store.messagesById[messageId]
      if (userMessage?.deliveryStatus?.[role.id] === 'pending') {
        userMessage.deliveryStatus[role.id] = 'sent'
        updateUserMessageDeliveryStatus(userMessage)
      }
      if (userMessage) role.contextCursor = Math.max(role.contextCursor, userMessage.seq)
      role.updatedAt = deps.now()
      chat.updatedAt = role.updatedAt
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, store }
  }

  const handleRoleStatus = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const mappedStatus = mapRuntimeRoleStatus(message.status)
    if (!mappedStatus) return { ok: false, error: '未知人员状态' }

    const identity = readIdentityOptional(deps, message, sender)
    if (!identity) {
      deps.log.warn('role-status:missing-identity', {
        runtimeStatus: message.status,
        mappedStatus,
        error: message.error,
        senderUrl: sender.url,
        tabId: messageTabId(message, sender),
        frameId: senderFrameId(sender),
      })
      return { ok: false, error: '缺少 chatId/roleId，已忽略状态更新' }
    }

    const timestamp = deps.now()
    deps.log.info('role-status:received', {
      ...identity,
      runtimeStatus: message.status,
      mappedStatus,
      error: message.error,
      senderUrl: sender.url,
      tabId: messageTabId(message, sender),
      frameId: senderFrameId(sender),
    })

    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, identity.chatId)
      const role = requireRole(store, chat.id, identity.roleId)
      const keepActivePromptError = mappedStatus === 'error' && Boolean(role.lastPromptMessageId)
      role.status = keepActivePromptError ? 'thinking' : mappedStatus
      role.updatedAt = timestamp
      if (mappedStatus === 'ready' || (mappedStatus === 'error' && !keepActivePromptError)) delete role.lastPromptMessageId
      if (mappedStatus === 'ready' || (mappedStatus === 'error' && !keepActivePromptError)) delete role.replyAttemptId
      if (mappedStatus === 'stopped') role.replyAttemptId = deps.newId('stopped')
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = timestamp
      return role
    })

    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleSiteStatusUpdate = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const siteId = readSiteId(message.siteId)
    const status = readSiteHealthStatus(message.status)
    if (!siteId || !status) return { ok: false, error: '未知页面健康状态' }

    const identity = readIdentityOptional(deps, message, sender)
    if (!identity) {
      deps.log.warn('site-status:missing-identity', {
        siteId,
        status,
        detail: readOptionalString(message.detail),
        senderUrl: sender.url,
        tabId: messageTabId(message, sender),
        frameId: senderFrameId(sender),
      })
      return { ok: false, error: '缺少 chatId/roleId，已忽略页面健康状态' }
    }

    const timestamp = deps.now()
    const detail = readOptionalString(message.detail)
    deps.log.info('site-status:received', { ...identity, siteId, status, detail, senderUrl: sender.url })
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, identity.chatId)
      const role = requireRole(store, chat.id, identity.roleId)
      role.siteHealth = {
        siteId,
        status,
        ...(detail ? { detail } : {}),
        updatedAt: timestamp,
      }
      role.updatedAt = timestamp
      chat.updatedAt = timestamp
      return role
    })

    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleRoleReply = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const identity = readIdentity(deps, message, sender)
    const content = readReplyContent(message.content)
    const images = readReplyImageSources(message.images)
    if (!content && images.length === 0) throw new Error('回复内容不能为空')
    if (images.length > 0 && !isBoundImageSender(deps, identity, message, sender)) throw new Error('图片回复只能来自已绑定的 ChatGPT 或 Gemini 页面')
    const contentFormat = message.contentFormat === 'markdown' ? 'markdown' : undefined
    const promptMessageId = readOptionalString(message.messageId)
    const replyAttemptId = readOptionalString(message.replyAttemptId)
    const timestamp = deps.now()
    const replyMessageId = deps.newId('msg')
    const attachments = images.length > 0
      ? await requireImageAttachmentService(deps).captureReplyImages({ chatId: identity.chatId, messageId: replyMessageId, images })
      : undefined
    deps.log.info('role-reply:received', { ...identity, promptMessageId, replyAttemptId, contentLength: content.length, imageCount: images.length, senderUrl: sender.url })

    let mutation: Awaited<ReturnType<typeof mutateStore<{ ignored: true; reason: string; roleId: string; promptMessageId: string | undefined } | { ignored: false; reply: GroupMessage }>>>
    try {
      mutation = await mutateStore(store => {
        const chat = requireChat(store, identity.chatId)
        const role = requireRole(store, chat.id, identity.roleId)
        const staleReason = staleReplyReason(store, chat, role, promptMessageId, replyAttemptId)
        if (staleReason) {
          return { ignored: true as const, reason: staleReason, roleId: role.id, promptMessageId }
        }

        updateConversation(role, readOptionalString(message.conversationUrl), readOptionalString(message.conversationId))

        const reply: GroupMessage = {
          id: replyMessageId,
          chatId: chat.id,
          seq: chat.nextMessageSeq,
          type: 'assistant',
          content,
          contentFormat,
          ...(attachments?.length ? { attachments } : {}),
          roleId: role.id,
          roleName: role.name,
          sourceMessageId: promptMessageId,
          createdAt: timestamp,
          status: 'received',
        }
        store.messagesById[reply.id] = reply
        chat.messageIds.push(reply.id)
        chat.nextMessageSeq += 1
        markChatHasNewMessage(store, chat)

        if (promptMessageId) {
          const userMessage = store.messagesById[promptMessageId]
          if (userMessage?.deliveryStatus?.[role.id]) {
            userMessage.deliveryStatus[role.id] = 'received'
            updateUserMessageDeliveryStatus(userMessage)
          }
        }

        role.status = 'ready'
        role.lastReplyAt = timestamp
        role.updatedAt = timestamp
        if (!promptMessageId || role.lastPromptMessageId === promptMessageId) delete role.lastPromptMessageId
        if (!replyAttemptId || role.replyAttemptId === replyAttemptId) delete role.replyAttemptId
        chat.status = deps.getChatStatusFromRoles(store, chat)
        chat.updatedAt = timestamp
        return { ignored: false as const, reply }
      })
    } catch (error) {
      await deleteReadyAttachmentsBestEffort(deps, attachments, 'role-reply:attachment-cleanup-failed')
      throw error
    }
    const { store, result } = mutation

    if (result.ignored) {
      await deleteReadyAttachmentsBestEffort(deps, attachments, 'role-reply:attachment-cleanup-failed')
      deps.log.warn('role-reply:ignored-stale', { ...identity, promptMessageId: result.promptMessageId, reason: result.reason })
      return { ok: true, ignored: true, reason: result.reason, store }
    }

    deps.log.info('role-reply:stored', { chatId: result.reply.chatId, roleId: result.reply.roleId, replyMessageId: result.reply.id })
    await deps.broadcastStoreUpdated(store)
    if (promptMessageId) clearRoleErrorRetryCount(roleErrorRetryCounts, identity.chatId, identity.roleId, promptMessageId)
    if (promptMessageId) await deps.promptDeliveryLimiter?.complete(identity.chatId, promptMessageId, identity.roleId)
    if (promptMessageId) await maybeAdvanceOrchestrationRun(deps, { chatId: identity.chatId, roleId: identity.roleId, promptMessageId, replyMessage: result.reply })
    return { ok: true, message: result.reply, store }
  }

  const handleRoleReplyResync = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const identity = readIdentity(deps, message, sender)
    const messageId = requireString(message.messageId, '缺少消息 ID')
    const content = readReplyContent(message.content)
    const images = readReplyImageSources(message.images)
    if (!content && images.length === 0) throw new Error('回复内容不能为空')
    if (images.length > 0 && !isBoundImageSender(deps, identity, message, sender)) throw new Error('图片回复只能来自已绑定的 ChatGPT 或 Gemini 页面')
    const contentFormat = message.contentFormat === 'markdown' ? 'markdown' : undefined
    const timestamp = deps.now()
    const attachments = images.length > 0
      ? await requireImageAttachmentService(deps).captureReplyImages({ chatId: identity.chatId, messageId, images })
      : []
    deps.log.info('role-reply-resync:received', { ...identity, messageId, contentLength: content.length, imageCount: images.length, senderUrl: sender.url })

    let mutation: Awaited<ReturnType<typeof mutateStore<{ message: GroupMessage; previousAttachmentIds: string[] }>>>
    try {
      mutation = await mutateStore(store => {
        const chat = requireChat(store, identity.chatId)
        const role = requireRole(store, chat.id, identity.roleId)
        const assistantMessage = store.messagesById[messageId]
        if (!isAssistantMessageForRole(assistantMessage, chat, role)) throw new Error('该回复不属于这个人员')

        const previousAttachmentIds = readyAttachmentIds(assistantMessage.attachments)
        updateConversation(role, readOptionalString(message.conversationUrl), readOptionalString(message.conversationId))
        assistantMessage.content = content
        assistantMessage.contentFormat = contentFormat
        assistantMessage.attachments = attachments.length > 0 ? attachments : undefined
        assistantMessage.status = 'received'
        chat.updatedAt = timestamp
        return { message: assistantMessage, previousAttachmentIds }
      })
    } catch (error) {
      await deleteReadyAttachmentsBestEffort(deps, attachments, 'role-reply-resync:attachment-cleanup-failed')
      throw error
    }
    const { store, result } = mutation
    await deleteAttachmentIdsBestEffort(deps, result.previousAttachmentIds, 'role-reply-resync:previous-attachment-cleanup-failed')

    deps.log.info('role-reply-resync:stored', { chatId: result.message.chatId, roleId: result.message.roleId, replyMessageId: result.message.id })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, message: result.message, store }
  }

  const handleRoleError = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const identity = readIdentity(deps, message, sender)
    const reason = readOptionalString(message.reason) ?? readOptionalString(message.error) ?? '人员执行失败'
    const promptMessageId = readOptionalString(message.messageId)
    const replyAttemptId = readOptionalString(message.replyAttemptId)
    deps.log.warn('role-error:received', { ...identity, promptMessageId, replyAttemptId, reason, senderUrl: sender.url, tabId: messageTabId(message, sender), frameId: senderFrameId(sender) })

    const retry = promptMessageId
      ? await prepareRoleErrorRetry(deps, roleErrorRetryCounts, identity.chatId, identity.roleId, promptMessageId, replyAttemptId, reason)
      : undefined
    if (retry) {
      await deps.broadcastStoreUpdated(retry.store)
      deps.log.warn('role-error:retry-scheduled', {
        chatId: identity.chatId,
        roleId: identity.roleId,
        messageId: promptMessageId,
        retryCount: retry.retryCount,
        delayMs: retry.delayMs,
        reason,
      })
      await waitForRetryDelay(deps, retry.delayMs)
      if (retry.externalDelivery) {
        const responseStore = await sendExternalModelDelivery(deps, externalModelClient, externalModelRuns, retry.externalDelivery) ?? retry.store
        return { ok: true, retried: true, store: responseStore }
      }
      await enqueuePromptDelivery(deps, identity.chatId, promptMessageId!, retry.delivery)
      return { ok: true, retried: true, store: retry.store }
    }

    const timestamp = deps.now()
    const { store } = await mutateStore(store => {
      const chat = requireChat(store, identity.chatId)
      const role = requireRole(store, chat.id, identity.roleId)
      role.status = 'error'
      role.updatedAt = timestamp
      if (!promptMessageId || role.lastPromptMessageId === promptMessageId) delete role.lastPromptMessageId
      if (!replyAttemptId || role.replyAttemptId === replyAttemptId) delete role.replyAttemptId

      if (promptMessageId) {
        const userMessage = store.messagesById[promptMessageId]
        if (userMessage?.deliveryStatus?.[role.id]) {
          userMessage.deliveryStatus[role.id] = 'error'
          updateUserMessageDeliveryStatus(userMessage)
        }
        if (isUserMessageForRole(userMessage, chat, role)) {
          upsertFailedAssistantAfterPrompt(store, chat, role, promptMessageId, reason, timestamp, deps.newId)
        }
      }
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = role.updatedAt
    })

    await deps.broadcastStoreUpdated(store)
    await deps.sendError(reason)
    if (promptMessageId) clearRoleErrorRetryCount(roleErrorRetryCounts, identity.chatId, identity.roleId, promptMessageId)
    if (promptMessageId) await deps.promptDeliveryLimiter?.complete(identity.chatId, promptMessageId, identity.roleId)
    if (promptMessageId) await markOrchestrationRoleError(deps, { chatId: identity.chatId, roleId: identity.roleId, promptMessageId, error: reason })
    return { ok: true, store }
  }

  return [
    { type: 'GROUP_ROLE_RETRY_REPLY', handler: handleRoleRetryReply },
    { type: 'GROUP_ROLE_STOP_REPLY', handler: handleRoleStopReply },
    { type: 'GROUP_NOTE_SAVE', handler: handleNoteSave },
    { type: 'GROUP_MESSAGE_HIGHLIGHT_CREATE', handler: handleMessageHighlightCreate },
    { type: 'GROUP_MESSAGE_RESYNC_REPLY', handler: handleMessageResyncReply },
    { type: 'GROUP_MESSAGE_SEND', handler: handleMessageSend },
    {
      type: 'TEAM_FRAME_ROLE_READY',
      handler: (message, sender) => readOptionalString(message.chatId) ? handleFrameRoleReady(message, sender) : { ok: false, error: 'TEAM_FRAME_ROLE_READY 缺少 chatId' },
    },
    { type: 'TEAM_ROLE_CONVERSATION_UPDATED', handler: handleConversationUpdated },
    { type: 'TEAM_SEND_ACK', handler: handleSendAck },
    { type: 'TEAM_ROLE_STATUS', handler: handleRoleStatus },
    { type: 'TEAM_SITE_STATUS_UPDATE', handler: handleSiteStatusUpdate },
    { type: 'TEAM_ROLE_REPLY', handler: handleRoleReply },
    { type: 'TEAM_ROLE_REPLY_RESYNC', handler: handleRoleReplyResync },
    { type: 'TEAM_ROLE_ERROR', handler: handleRoleError },
  ]
}

function getRoleReplyHistory(store: OpenTeamStore, chat: GroupChat, roleId: string, limit = 100): string[] {
  return getChatMessages(store, chat)
    .filter(message => message.type === 'assistant' && message.roleId === roleId && message.content.trim())
    .slice(-limit)
    .map(message => message.content)
}

function staleReplyReason(store: OpenTeamStore, chat: GroupChat, role: GroupRole, promptMessageId: string | undefined, replyAttemptId?: string): string | undefined {
  if (!promptMessageId) return 'missing-prompt-message-id'
  if (role.lastPromptMessageId !== promptMessageId) return 'prompt-message-mismatch'
  if (replyAttemptId && role.replyAttemptId && role.replyAttemptId !== replyAttemptId) return 'reply-attempt-mismatch'

  const userMessage = store.messagesById[promptMessageId]
  if (!userMessage || userMessage.chatId !== chat.id || userMessage.type !== 'user') return 'prompt-message-not-found'

  const deliveryStatus = userMessage.deliveryStatus?.[role.id]
  if (deliveryStatus !== 'pending' && deliveryStatus !== 'sent') return `delivery-already-${deliveryStatus ?? 'missing'}`

  return undefined
}

function markChatHasNewMessage(store: OpenTeamStore, chat: GroupChat): void {
  if (store.currentChatId === chat.id) return
  store.viewState ??= { chatReadSeqById: {}, chatHasNewMessageById: {} }
  store.viewState.chatHasNewMessageById ??= {}
  store.viewState.chatHasNewMessageById[chat.id] = true
}

function readIdentity(deps: MessageHandlersDependencies, message: RuntimeMessage, sender: chrome.runtime.MessageSender): { chatId: string; roleId: string } {
  const identity = readIdentityOptional(deps, message, sender)
  if (identity) return identity
  throw new Error('缺少 chatId/roleId')
}

function readIdentityOptional(deps: MessageHandlersDependencies, message: RuntimeMessage, sender: chrome.runtime.MessageSender): { chatId: string; roleId: string } | undefined {
  const chatId = readOptionalString(message.chatId)
  const roleId = readOptionalString(message.roleId)
  if (chatId && roleId) return { chatId, roleId }

  const tabId = messageTabId(message, sender)
  if (tabId !== undefined) {
    const binding = deps.runtimeFrames.getByAddress(tabId, senderFrameId(sender))
    if (binding) return { chatId: binding.chatId, roleId: binding.roleId }
  }

  return undefined
}

function updateConversation(role: GroupRole, conversationUrl: string | undefined, conversationId: string | undefined): void {
  const safeUrl = normalizeSupportedChatConversationUrl(conversationUrl)
  const conversationIdFromUrl = extractSupportedConversationId(safeUrl)
  if (safeUrl && conversationIdFromUrl) {
    role.geminiConversationUrl = safeUrl
    role.geminiConversationId = conversationIdFromUrl
    return
  }

  if (isMeaningfulConversationId(conversationId)) role.geminiConversationId = conversationId
}

function isMeaningfulConversationId(value: string | undefined): value is string {
  return Boolean(value && value !== '__default__')
}

async function markDeliveryError(deps: MessageHandlersDependencies, chatId: string, roleId: string, messageId: string, reason: string): Promise<void> {
  deps.log.warn('delivery:error', { chatId, roleId, messageId, reason })
  const { store } = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const role = requireRole(store, chat.id, roleId)
    role.status = 'error'
    role.updatedAt = deps.now()
    if (role.lastPromptMessageId === messageId) delete role.lastPromptMessageId
    delete role.replyAttemptId

    const userMessage = store.messagesById[messageId]
    if (userMessage?.deliveryStatus) {
      userMessage.deliveryStatus[roleId] = 'error'
      updateUserMessageDeliveryStatus(userMessage)
    }
    chat.status = deps.getChatStatusFromRoles(store, chat)
    chat.updatedAt = role.updatedAt
  })
  await deps.broadcastStoreUpdated(store)
  await deps.sendError(reason)
}

function updateUserMessageDeliveryStatus(message: GroupMessage): void {
  const statuses = Object.values(message.deliveryStatus ?? {})
  if (statuses.length === 0) return
  if (statuses.every(status => status === 'error')) {
    message.status = 'error'
    return
  }
  if (statuses.every(status => status === 'received' || status === 'error')) {
    message.status = 'received'
    return
  }
  if (statuses.every(status => status === 'sent' || status === 'received' || status === 'error')) {
    message.status = 'sent'
    return
  }
  message.status = 'pending'
}

type PreparedRoleErrorRetry = {
  store: OpenTeamStore
  retryCount: number
  delayMs: number
} & (
  | { delivery: PromptDelivery; externalDelivery?: undefined }
  | { delivery?: undefined; externalDelivery: ExternalPromptDelivery }
)

async function prepareRoleErrorRetry(
  deps: MessageHandlersDependencies,
  retryCounts: Map<string, number>,
  chatId: string,
  roleId: string,
  promptMessageId: string,
  replyAttemptId: string | undefined,
  reason: string,
): Promise<PreparedRoleErrorRetry | undefined> {
  if (!isRetryableRoleError(reason)) return undefined
  const retryDelays = deps.roleErrorRetryDelaysMs ?? DEFAULT_ROLE_ERROR_RETRY_DELAYS_MS
  const key = roleErrorRetryKey(chatId, roleId, promptMessageId)
  const usedRetries = retryCounts.get(key) ?? 0
  if (usedRetries >= retryDelays.length) return undefined

  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const role = requireRole(store, chat.id, roleId)
    const staleReason = staleReplyReason(store, chat, role, promptMessageId, replyAttemptId)
    if (staleReason) return undefined
    const userMessage = store.messagesById[promptMessageId]
    if (!isUserMessageForRole(userMessage, chat, role)) return undefined
    if (userMessage.deliveryStatus?.[role.id] !== 'sent') return undefined
    if (hasAssistantReplyAfterPrompt(store, chat, role, promptMessageId)) return undefined

    const roles = getChatRoles(store, chat)
    const messages = getChatMessages(store, chat)
    const reference = userMessage.references?.[0]
    let prepared: PreparedRolePromptDelivery
    try {
      prepared = prepareRolePromptDelivery({ store, chat, role, userMessage, roles, messages, reference, timestamp, newId: deps.newId, runtimeFrames: deps.runtimeFrames })
    } catch {
      return undefined
    }

    userMessage.deliveryStatus ??= {}
    userMessage.deliveryStatus[role.id] = 'pending'
    updateUserMessageDeliveryStatus(userMessage)
    role.status = 'thinking'
    role.lastPromptMessageId = userMessage.id
    role.replyAttemptId = prepared.replyAttemptId
    role.updatedAt = timestamp
    chat.status = 'running'
    chat.updatedAt = timestamp
    return prepared
  })

  if (!result) return undefined
  const retryCount = usedRetries + 1
  retryCounts.set(key, retryCount)
  return { ...result, store, retryCount, delayMs: retryDelays[usedRetries] ?? 0 }
}

function isRetryableRoleError(reason: string): boolean {
  const normalized = reason.toLowerCase()
  const nonRetryablePatterns = [
    'abort',
    'aborted',
    'unauthorized',
    'invalid_api_key',
    'model_not_found',
    '401',
    '403',
    'api key',
    '已停止',
    '停止回复',
    '用户停止',
    '找不到外部模型',
    '模型不存在',
    '密钥',
  ]
  return !nonRetryablePatterns.some(pattern => normalized.includes(pattern))
}

function clearRoleErrorRetryCount(retryCounts: Map<string, number>, chatId: string, roleId: string, messageId: string): void {
  retryCounts.delete(roleErrorRetryKey(chatId, roleId, messageId))
}

function roleErrorRetryKey(chatId: string, roleId: string, messageId: string): string {
  return `${chatId}:${roleId}:${messageId}`
}

async function isPromptDeliveryStillActive(
  chatId: string,
  roleId: string,
  messageId: string,
  replyAttemptId: string | undefined,
): Promise<boolean> {
  const { result } = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const role = requireRole(store, chat.id, roleId)
    if (role.status === 'stopped') return false
    if (staleReplyReason(store, chat, role, messageId, replyAttemptId)) return false
    if (hasAssistantReplyAfterPrompt(store, chat, role, messageId)) return false
    return true
  })
  return result
}

function hasAssistantReplyAfterPrompt(store: OpenTeamStore, chat: GroupChat, role: GroupRole, promptMessageId: string): boolean {
  const promptIndex = chat.messageIds.indexOf(promptMessageId)
  if (promptIndex < 0) return false
  for (let index = promptIndex + 1; index < chat.messageIds.length; index += 1) {
    const message = store.messagesById[chat.messageIds[index]]
    if (isAssistantMessageForRole(message, chat, role) && (message.status === 'received' || Boolean(message.content.trim()))) return true
  }
  return false
}

async function waitForRetryDelay(deps: MessageHandlersDependencies, delayMs: number): Promise<void> {
  if (delayMs <= 0) return
  if (deps.waitForRetry) {
    await deps.waitForRetry(delayMs)
    return
  }
  await new Promise<void>(resolve => setTimeout(resolve, delayMs))
}

async function sendPromptDeliveries(deps: MessageHandlersDependencies, chatId: string, messageId: string, deliveries: PromptDelivery[]): Promise<void> {
  await Promise.all(deliveries.map(delivery => enqueuePromptDelivery(deps, chatId, messageId, delivery)))
}

async function enqueuePromptDelivery(deps: MessageHandlersDependencies, chatId: string, messageId: string, delivery: PromptDelivery): Promise<void> {
  const send = () => sendPromptDelivery(deps, chatId, messageId, delivery)
  if (!deps.promptDeliveryLimiter) {
    await send()
    return
  }
  await deps.promptDeliveryLimiter.enqueue({
    chatId,
    messageId,
    roleId: delivery.roleId,
    chatSite: delivery.chatSite,
    send,
  })
}

async function sendPromptDelivery(deps: MessageHandlersDependencies, chatId: string, messageId: string, delivery: PromptDelivery): Promise<boolean> {
  return sendPromptDeliveryWithRetry({
    log: deps.log,
    sendPrompt: deps.sendPrompt,
    getLatestBinding: (targetChatId, roleId) => deps.runtimeFrames.getByRole(targetChatId, roleId),
    isDeliveryStillActive: isPromptDeliveryStillActive,
    markDeliveryError: (targetChatId, roleId, targetMessageId, reason) => markDeliveryError(deps, targetChatId, roleId, targetMessageId, reason),
    requestRoleRecovery: deps.requestRoleRecovery,
    waitForRetry: deps.waitForRetry,
  }, {
    chatId,
    messageId,
    delivery,
    retryDelaysMs: deps.deliveryRetryDelaysMs ?? DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS,
  })
}

async function sendExternalModelDelivery(deps: MessageHandlersDependencies, client: ExternalModelClient, runs: ExternalModelRunRegistry, delivery: ExternalPromptDelivery): Promise<OpenTeamStore | undefined> {
  const controller = new AbortController()
  runs.register(delivery.chatId, delivery.roleId, delivery.replyAttemptId, controller)
  let replyMessageId: string | undefined
  let content = ''
  try {
    deps.log.info('external-model:send:start', {
      chatId: delivery.chatId,
      roleId: delivery.roleId,
      messageId: delivery.messageId,
      modelId: delivery.model.id,
      format: delivery.model.format,
      promptLength: delivery.prompt.length,
    })

    const initialized = await createExternalAssistantPlaceholder(deps, delivery)
    if (initialized.ignored) {
      deps.log.warn('external-model:reply:ignored-stale', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, reason: initialized.reason })
      return initialized.store
    }
    replyMessageId = initialized.replyMessageId
    await deps.broadcastStoreUpdated(initialized.store)

    const retryDelays = deps.externalModelRetryDelaysMs ?? DEFAULT_EXTERNAL_MODEL_RETRY_DELAYS_MS
    for (let attemptIndex = 0; attemptIndex <= retryDelays.length; attemptIndex += 1) {
      try {
        content = ''
        const stream = typeof client.stream === 'function'
          ? client.stream({ model: delivery.model, prompt: delivery.prompt, abortSignal: controller.signal })
          : streamCompleteFallback(client, { model: delivery.model, prompt: delivery.prompt, abortSignal: controller.signal })
        for await (const chunk of abortableChunks(stream, controller.signal)) {
          throwIfAborted(controller.signal)
          if (!chunk) continue
          content += chunk
          const update = await updateExternalAssistantContent(deps, delivery, replyMessageId, content)
          if (update.ignored) {
            deps.log.warn('external-model:stream:ignored-stale', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, reason: update.reason })
            return update.store
          }
          await deps.broadcastStoreUpdated(update.store)
        }
        throwIfAborted(controller.signal)
        if (!content.trim()) throw new Error('外部模型返回格式无效')
        break
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) throw error
        if (content.trim()) throw error
        const reason = error instanceof Error ? error.message : String(error)
        const canRetry = attemptIndex < retryDelays.length && await isPromptDeliveryStillActive(delivery.chatId, delivery.roleId, delivery.messageId, delivery.replyAttemptId)
        if (!canRetry) throw error

        const delayMs = retryDelays[attemptIndex] ?? 0
        deps.log.warn('external-model:retry-scheduled', {
          chatId: delivery.chatId,
          roleId: delivery.roleId,
          messageId: delivery.messageId,
          retryCount: attemptIndex + 1,
          delayMs,
          reason,
        })
        await waitForRetryDelay(deps, delayMs)
      }
    }

    const finalized = await finishExternalAssistantReply(deps, delivery, replyMessageId, content)
    if (finalized.ignored) {
      deps.log.warn('external-model:reply:ignored-stale', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, reason: finalized.reason })
      return finalized.store
    }
    deps.log.info('external-model:reply:stored', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, replyMessageId })
    await deps.broadcastStoreUpdated(finalized.store)
    return finalized.store
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      deps.log.info('external-model:send:aborted', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, replyMessageId, contentLength: content.length })
      if (replyMessageId) {
        const stopped = await markExternalAssistantStopped(deps, delivery, replyMessageId, content)
        await deps.broadcastStoreUpdated(stopped.store)
        return stopped.store
      }
      return undefined
    }
    const reason = error instanceof Error ? error.message : String(error)
    deps.log.warn('external-model:send:failed', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, reason })
    await markDeliveryError(deps, delivery.chatId, delivery.roleId, delivery.messageId, reason)
    return undefined
  } finally {
    runs.unregister(delivery.chatId, delivery.roleId, delivery.replyAttemptId)
  }
}

async function createExternalAssistantPlaceholder(
  deps: MessageHandlersDependencies,
  delivery: ExternalPromptDelivery,
): Promise<{ ignored: true; reason: string; store: OpenTeamStore } | { ignored: false; replyMessageId: string; store: OpenTeamStore }> {
  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
    const chat = requireChat(store, delivery.chatId)
    const role = requireRole(store, chat.id, delivery.roleId)
    const staleReason = staleReplyReason(store, chat, role, delivery.messageId, delivery.replyAttemptId)
    if (staleReason) return { ignored: true as const, reason: staleReason }

    const reply: GroupMessage = {
      id: deps.newId('msg'),
      chatId: chat.id,
      seq: chat.nextMessageSeq,
      type: 'assistant',
      content: '',
      contentFormat: 'markdown',
      roleId: role.id,
      roleName: role.name,
      sourceMessageId: delivery.messageId,
      createdAt: timestamp,
      status: 'pending',
    }
    store.messagesById[reply.id] = reply
    chat.messageIds.push(reply.id)
    chat.nextMessageSeq += 1

    const userMessage = store.messagesById[delivery.messageId]
    if (userMessage?.deliveryStatus?.[role.id] === 'pending') {
      userMessage.deliveryStatus[role.id] = 'sent'
      updateUserMessageDeliveryStatus(userMessage)
    }
    role.updatedAt = timestamp
    chat.updatedAt = timestamp
    return { ignored: false as const, replyMessageId: reply.id }
  })
  return result.ignored ? { ...result, store } : { ...result, store }
}

async function updateExternalAssistantContent(
  deps: MessageHandlersDependencies,
  delivery: ExternalPromptDelivery,
  replyMessageId: string,
  content: string,
): Promise<{ ignored: true; reason: string; store: OpenTeamStore } | { ignored: false; store: OpenTeamStore }> {
  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
    const chat = requireChat(store, delivery.chatId)
    const role = requireRole(store, chat.id, delivery.roleId)
    const staleReason = staleReplyReason(store, chat, role, delivery.messageId, delivery.replyAttemptId)
    if (staleReason) return { ignored: true as const, reason: staleReason }
    const reply = store.messagesById[replyMessageId]
    if (!isAssistantMessageForRole(reply, chat, role)) return { ignored: true as const, reason: 'reply-message-not-found' }
    reply.content = content
    reply.status = 'pending'
    role.updatedAt = timestamp
    chat.updatedAt = timestamp
    return { ignored: false as const }
  })
  return result.ignored ? { ...result, store } : { ...result, store }
}

async function finishExternalAssistantReply(
  deps: MessageHandlersDependencies,
  delivery: ExternalPromptDelivery,
  replyMessageId: string,
  content: string,
): Promise<{ ignored: true; reason: string; store: OpenTeamStore } | { ignored: false; store: OpenTeamStore }> {
  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, delivery.chatId)
      const role = requireRole(store, chat.id, delivery.roleId)
      const staleReason = staleReplyReason(store, chat, role, delivery.messageId, delivery.replyAttemptId)
      if (staleReason) return { ignored: true as const, reason: staleReason }
      const reply = store.messagesById[replyMessageId]
      if (!isAssistantMessageForRole(reply, chat, role)) return { ignored: true as const, reason: 'reply-message-not-found' }
      reply.content = content
      reply.status = 'received'
      markChatHasNewMessage(store, chat)

      const userMessage = store.messagesById[delivery.messageId]
      if (userMessage?.deliveryStatus?.[role.id]) {
        userMessage.deliveryStatus[role.id] = 'received'
        updateUserMessageDeliveryStatus(userMessage)
      }

      role.status = 'ready'
      role.lastReplyAt = timestamp
      role.updatedAt = timestamp
      if (role.lastPromptMessageId === delivery.messageId) delete role.lastPromptMessageId
      if (role.replyAttemptId === delivery.replyAttemptId) delete role.replyAttemptId
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = timestamp
      return { ignored: false as const }
    })
  return result.ignored ? { ...result, store } : { ...result, store }
}

async function markExternalAssistantStopped(
  deps: MessageHandlersDependencies,
  delivery: ExternalPromptDelivery,
  replyMessageId: string,
  content: string,
): Promise<{ store: OpenTeamStore }> {
  const timestamp = deps.now()
  const { store } = await mutateStore(store => {
    const chat = requireChat(store, delivery.chatId)
    const role = requireRole(store, chat.id, delivery.roleId)
    const reply = store.messagesById[replyMessageId]
    const hasContent = Boolean(content.trim())
    const replyAlreadyFinalized = isAssistantMessageForRole(reply, chat, role) && reply.status !== 'pending'
    if (isAssistantMessageForRole(reply, chat, role) && !replyAlreadyFinalized) {
      reply.content = content
      reply.status = hasContent ? 'received' : 'error'
    }

    const userMessage = store.messagesById[delivery.messageId]
    if (userMessage?.deliveryStatus?.[role.id] && !replyAlreadyFinalized) {
      userMessage.deliveryStatus[role.id] = hasContent ? 'received' : 'error'
      updateUserMessageDeliveryStatus(userMessage)
    }

    const stoppedSamePrompt = role.lastPromptMessageId === delivery.messageId
    if (stoppedSamePrompt) {
      role.status = 'stopped'
      if (hasContent) delete role.lastPromptMessageId
    }
    if (hasContent && stoppedSamePrompt) delete role.replyAttemptId
    role.updatedAt = timestamp
    chat.status = deps.getChatStatusFromRoles(store, chat)
    chat.updatedAt = timestamp
  })
  return { store }
}

async function* streamCompleteFallback(client: ExternalModelClient, input: { model: ExternalModelConfig; prompt: string; abortSignal?: AbortSignal }): AsyncIterable<string> {
  const result = await client.complete(input)
  yield result.content
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isReceiverDisconnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Could not establish connection') || message.includes('Receiving end does not exist')
}

function finalizeActiveExternalAssistantReply(store: OpenTeamStore, chat: GroupChat, role: GroupRole, promptMessageId: string): boolean {
  const reply = findPendingAssistantAfterPrompt(store, chat, role, promptMessageId)
  if (!reply) return false

  if (!reply.content.trim()) reply.content = '已停止回复'
  reply.status = 'received'

  const userMessage = store.messagesById[promptMessageId]
  if (userMessage?.deliveryStatus?.[role.id]) {
    userMessage.deliveryStatus[role.id] = 'received'
    updateUserMessageDeliveryStatus(userMessage)
  }

  role.status = 'stopped'
  delete role.lastPromptMessageId
  delete role.replyAttemptId
  return true
}

function findPendingAssistantAfterPrompt(store: OpenTeamStore, chat: GroupChat, role: GroupRole, promptMessageId: string): AssistantGroupMessage | undefined {
  const promptIndex = chat.messageIds.indexOf(promptMessageId)
  if (promptIndex < 0) return undefined

  for (let index = chat.messageIds.length - 1; index > promptIndex; index -= 1) {
    const message = store.messagesById[chat.messageIds[index]]
    if (isAssistantMessageForRole(message, chat, role) && message.status === 'pending') return message
  }
  return undefined
}

function findFailedOrPendingAssistantAfterPrompt(store: OpenTeamStore, chat: GroupChat, role: GroupRole, promptMessageId: string): AssistantGroupMessage | undefined {
  const promptIndex = chat.messageIds.indexOf(promptMessageId)
  if (promptIndex < 0) return undefined

  for (let index = chat.messageIds.length - 1; index > promptIndex; index -= 1) {
    const message = store.messagesById[chat.messageIds[index]]
    if (isAssistantMessageForRole(message, chat, role) && (message.status === 'pending' || message.status === 'error')) {
      const previousPrompt = findPromptBeforeAssistant(store, chat, role, message.id)
      if (previousPrompt?.id === promptMessageId) return message
    }
  }
  return undefined
}

function upsertFailedAssistantAfterPrompt(
  store: OpenTeamStore,
  chat: GroupChat,
  role: GroupRole,
  promptMessageId: string,
  reason: string,
  timestamp: number,
  newId: MessageHandlersDependencies['newId'],
): AssistantGroupMessage {
  const content = roleFailureReplyContent(reason)
  const existingReply = findFailedOrPendingAssistantAfterPrompt(store, chat, role, promptMessageId)
  if (existingReply) {
    existingReply.content = content
    existingReply.contentFormat = 'markdown'
    existingReply.status = 'error'
    return existingReply
  }

  const reply: AssistantGroupMessage = {
    id: newId('msg'),
    chatId: chat.id,
    seq: chat.nextMessageSeq,
    type: 'assistant',
    content,
    contentFormat: 'markdown',
    roleId: role.id,
    roleName: role.name,
    sourceMessageId: promptMessageId,
    createdAt: timestamp,
    status: 'error',
  }
  store.messagesById[reply.id] = reply
  chat.messageIds.push(reply.id)
  chat.nextMessageSeq += 1
  markChatHasNewMessage(store, chat)
  return reply
}

function roleFailureReplyContent(reason: string): string {
  const normalized = reason.toLowerCase()
  if (normalized === 'send_failed') return '⚠️ 发送失败，请检查 AI 窗口是否开启或尝试刷新页面。\n\n可以点击下方的重新回复按钮再试一次。'
  if (normalized === 'response_not_found') return '⚠️ 未检测到回复，可能是 AI 响应过慢或 DOM 结构已变更。\n\n可以点击下方的重新同步完整回复按钮尝试恢复。'
  if (normalized === 'timeout') return '⚠️ 回复超时了。\n\n可以点击下方的重新回复按钮再试一次。'
  if (normalized === 'site_blocked') return '⚠️ 站点阻断，请检查登录状态或处理 Cookie 弹窗。\n\n处理完成后点击重新回复。'
  if (/超时|timeout/i.test(reason)) return '回复超时了。\n\n可以点击下方的重新回复按钮再试一次。'
  return `回复失败：${reason}\n\n可以点击下方的重新回复按钮再试一次。`
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}

async function* abortableChunks<T>(stream: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  const iterator = stream[Symbol.asyncIterator]()
  let abortListener: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) {
      abortListener()
      return
    }
    signal.addEventListener('abort', abortListener, { once: true })
  })

  try {
    while (true) {
      const next = await Promise.race([iterator.next(), abortPromise])
      if (next.done) return
      yield next.value
    }
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener)
    if (signal.aborted) Promise.resolve(iterator.return?.()).catch(() => undefined)
  }
}

function createExternalModelRunRegistry(): ExternalModelRunRegistry {
  const runs = new Map<string, AbortController>()
  return {
    register(chatId, roleId, replyAttemptId, controller) {
      runs.set(externalModelRunKey(chatId, roleId, replyAttemptId), controller)
    },
    abort(chatId, roleId, replyAttemptId) {
      if (replyAttemptId) {
        runs.get(externalModelRunKey(chatId, roleId, replyAttemptId))?.abort()
        return
      }
      for (const [key, controller] of runs) {
        if (key.startsWith(`${chatId}:${roleId}:`)) controller.abort()
      }
    },
    unregister(chatId, roleId, replyAttemptId) {
      runs.delete(externalModelRunKey(chatId, roleId, replyAttemptId))
    },
  }
}

function externalModelRunKey(chatId: string, roleId: string, replyAttemptId: string): string {
  return `${chatId}:${roleId}:${replyAttemptId}`
}

function isStaleThinkingRole(role: GroupRole, timestamp: number): boolean {
  return role.status === 'thinking' && timestamp - role.updatedAt >= STALE_THINKING_MS
}

function isRoleDeliverable(role: GroupRole, binding: RuntimeFrameBinding | undefined, timestamp: number): boolean {
  if (!binding?.ready) return false
  return role.status === 'ready' || role.status === 'error' || role.status === 'stopped' || role.status === 'loading' || role.status === 'pending' || isStaleThinkingRole(role, timestamp)
}

function recoverDeliverableRoleStatus(role: GroupRole, timestamp: number, log: MessageHandlersDependencies['log']): void {
  if (role.status === 'ready') return

  log.warn('role:auto-recover-status', { roleId: role.id, roleName: role.name, previousStatus: role.status, lastPromptMessageId: role.lastPromptMessageId })
  role.status = 'ready'
  delete role.lastPromptMessageId
  delete role.replyAttemptId
  role.updatedAt = timestamp
}

function readPersonaLength(role: GroupRole): number {
  return (role.systemPrompt?.trim() || role.description?.trim() || role.name.trim()).length
}

type UserGroupMessage = GroupMessage & { type: 'user' }
type AssistantGroupMessage = GroupMessage & { type: 'assistant' }

function isUserMessageForRole(message: GroupMessage | undefined, chat: GroupChat, role: GroupRole): message is UserGroupMessage {
  return Boolean(
    message &&
      message.chatId === chat.id &&
      message.type === 'user' &&
      (!message.targetRoleIds || message.targetRoleIds.includes(role.id)),
  )
}

function isAssistantMessageForRole(message: GroupMessage | undefined, chat: GroupChat, role: GroupRole): message is AssistantGroupMessage {
  return Boolean(message && message.chatId === chat.id && message.type === 'assistant' && message.roleId === role.id)
}

function isPendingRetryStatus(message: GroupMessage, role: GroupRole): boolean {
  const deliveryStatus = message.deliveryStatus?.[role.id]
  return deliveryStatus === 'pending' || deliveryStatus === 'sent'
}

function findLatestPendingRetryMessage(store: OpenTeamStore, chat: GroupChat, role: GroupRole): GroupMessage | undefined {
  for (const messageId of [...chat.messageIds].reverse()) {
    const message = store.messagesById[messageId]
    if (isUserMessageForRole(message, chat, role) && isPendingRetryStatus(message, role)) return message
  }
  return undefined
}

interface RetryTarget {
  userMessage: GroupMessage
  discardMessageId?: string
}

function resolveRetryTarget(
  store: OpenTeamStore,
  chat: GroupChat,
  role: GroupRole,
  requestedMessageId: string | undefined,
  log: MessageHandlersDependencies['log'],
): RetryTarget | undefined {
  if (!requestedMessageId) {
    const userMessage = resolveRetryUserMessage(store, chat, role, undefined, log)
    return userMessage ? { userMessage } : undefined
  }

  const requestedMessage = store.messagesById[requestedMessageId]
  if (isUserMessageForRole(requestedMessage, chat, role)) return { userMessage: requestedMessage }

  if (isAssistantMessageForRole(requestedMessage, chat, role) && (isExternalModelRole(role) || requestedMessage.status === 'error')) {
    const userMessage = findPromptBeforeAssistant(store, chat, role, requestedMessage.id)
    return userMessage ? { userMessage, discardMessageId: requestedMessage.id } : undefined
  }

  return undefined
}

function findPromptBeforeAssistant(store: OpenTeamStore, chat: GroupChat, role: GroupRole, assistantMessageId: string): GroupMessage | undefined {
  const assistantIndex = chat.messageIds.indexOf(assistantMessageId)
  if (assistantIndex <= 0) return undefined

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = store.messagesById[chat.messageIds[index]]
    if (isUserMessageForRole(message, chat, role)) return message
  }
  return undefined
}

function discardMessage(store: OpenTeamStore, chat: GroupChat, messageId: string): void {
  delete store.messagesById[messageId]
  chat.messageIds = chat.messageIds.filter(id => id !== messageId)
  if (store.messageHighlightsById) delete store.messageHighlightsById[messageId]
}

function resolveRetryUserMessage(
  store: OpenTeamStore,
  chat: GroupChat,
  role: GroupRole,
  requestedMessageId: string | undefined,
  log: MessageHandlersDependencies['log'],
): GroupMessage | undefined {
  if (requestedMessageId) {
    const requestedMessage = store.messagesById[requestedMessageId]
    return isUserMessageForRole(requestedMessage, chat, role) ? requestedMessage : undefined
  }

  const activePromptMessage = role.lastPromptMessageId ? store.messagesById[role.lastPromptMessageId] : undefined
  if (isUserMessageForRole(activePromptMessage, chat, role) && isPendingRetryStatus(activePromptMessage, role)) return activePromptMessage

  const latestPendingMessage = findLatestPendingRetryMessage(store, chat, role)
  if (latestPendingMessage && role.lastPromptMessageId && latestPendingMessage.id !== role.lastPromptMessageId) {
    log.warn('role-retry-reply:stale-prompt-pointer', {
      chatId: chat.id,
      roleId: role.id,
      staleMessageId: role.lastPromptMessageId,
      retryMessageId: latestPendingMessage.id,
    })
  }
  return latestPendingMessage
}

function resolveReference(store: OpenTeamStore, chat: GroupChat, raw: unknown, newId: (prefix: string) => string): MessageReference | undefined {
  if (!isRecord(raw)) return undefined

  const messageId = readOptionalString(raw.messageId)
  if (messageId) {
    const message = store.messagesById[messageId]
    if (message && message.chatId === chat.id) {
      return {
        messageId: message.id,
        roleId: message.roleId,
        roleName: message.roleName,
        contentSnapshot: message.content,
      }
    }
  }

  const contentSnapshot = readOptionalString(raw.contentSnapshot)
  if (!contentSnapshot) return undefined
  return {
    messageId: messageId ?? newId('ref'),
    roleId: readOptionalString(raw.roleId),
    roleName: readOptionalString(raw.roleName),
    contentSnapshot,
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function resolveOrchestrationMentionFlow(
  store: OpenTeamStore,
  chat: GroupChat,
  target: 'default' | { name: string },
): OrchestrationFlow {
  const orderedFlows = (store.orchestrationFlowOrderByChatId[chat.id] ?? [])
    .map(flowId => store.orchestrationFlowsById[flowId])
    .filter((flow): flow is OrchestrationFlow => Boolean(flow && flow.chatId === chat.id))
  const extraFlows = Object.values(store.orchestrationFlowsById)
    .filter((flow): flow is OrchestrationFlow => Boolean(flow && flow.chatId === chat.id && !orderedFlows.some(ordered => ordered.id === flow.id)))
  const flows = [...orderedFlows, ...extraFlows]

  if (target === 'default') {
    const flow = flows[0]
    if (!flow) throw new Error('当前群聊还没有编排流程，请先创建或保存一个编排流程')
    return flow
  }

  const name = target.name.trim()
  const flow = flows.find(candidate => candidate.name.trim() === name)
  if (!flow) throw new Error(`找不到名为“${name}”的编排流程，请先创建或保存`)
  return flow
}

function readReplyContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readReplyImageSources(value: unknown): ReplyImageSource[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap(item => {
    if (!isRecord(item) || typeof item.sourceUrl !== 'string' || !item.sourceUrl.trim()) return []
    const width = readOptionalImageDimension(item.width)
    const height = readOptionalImageDimension(item.height)
    return [{
      sourceUrl: item.sourceUrl.trim(),
      ...(typeof item.alt === 'string' && item.alt.trim() ? { alt: item.alt.trim().slice(0, 500) } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }]
  })
}

function readOptionalImageDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : undefined
}

function readSiteId(value: unknown): ChatSite | undefined {
  if (value === 'gemini' || value === 'chatgpt' || value === 'claude' || value === 'deepseek' || value === 'grok') return value
  return undefined
}

function readSiteHealthStatus(value: unknown): RoleSiteHealthStatus | undefined {
  if (value === 'ready' || value === 'generating' || value === 'error' || value === 'blocked' || value === 'unauthorized') return value
  return undefined
}

function isTrustedImageSenderUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (
      url.hostname === 'chatgpt.com' ||
      url.hostname === 'chat.openai.com' ||
      url.hostname === 'gemini.google.com'
    )
  } catch {
    return false
  }
}

function isBoundImageSender(
  deps: MessageHandlersDependencies,
  identity: { chatId: string; roleId: string },
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): boolean {
  if (!isTrustedImageSenderUrl(sender.url)) return false
  const tabId = messageTabId(message, sender)
  if (tabId === undefined) return false
  const binding = deps.runtimeFrames.getByAddress(tabId, senderFrameId(sender))
  return Boolean(binding?.ready && binding.chatId === identity.chatId && binding.roleId === identity.roleId)
}

function requireImageAttachmentService(deps: MessageHandlersDependencies): NonNullable<MessageHandlersDependencies['imageAttachments']> {
  if (!deps.imageAttachments) throw new Error('图片存储尚未初始化')
  return deps.imageAttachments
}

function readyAttachmentIds(attachments: MessageImageAttachment[] | undefined): string[] {
  return (attachments ?? []).filter(attachment => attachment.status === 'ready').map(attachment => attachment.id)
}

async function deleteReadyAttachmentsBestEffort(
  deps: MessageHandlersDependencies,
  attachments: MessageImageAttachment[] | undefined,
  event: string,
): Promise<void> {
  await deleteAttachmentIdsBestEffort(deps, readyAttachmentIds(attachments), event)
}

async function deleteAttachmentIdsBestEffort(
  deps: MessageHandlersDependencies,
  ids: string[],
  event: string,
): Promise<void> {
  if (ids.length === 0 || !deps.imageAttachments) return
  try {
    await deps.imageAttachments.deleteByIds(ids)
  } catch (error) {
    deps.log.warn(event, {
      attachmentCount: ids.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function requireString(value: unknown, error: string): string {
  const result = readOptionalString(value)
  if (!result) throw new Error(error)
  return result
}

function requireNumber(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(error)
  return value
}

function requireNoteContent(value: unknown): NonNullable<OpenTeamStore['globalNote']> {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('笔记内容格式无效')
  return value as NonNullable<OpenTeamStore['globalNote']>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
