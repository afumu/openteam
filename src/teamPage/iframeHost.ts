import { getSafeSupportedChatIframeSrcForRole, getSupportedChatOrigin } from '../group/conversationUrl'
import type { ChatSite, GroupChat, GroupRole } from '../group/types'

export const FRAME_ASSIGN_MESSAGE = 'OPENTEAM_ASSIGN_FRAME_ROLE'
export const CHAT_IFRAME_ALLOW = 'clipboard-read; clipboard-write; microphone; camera; geolocation; autoplay; fullscreen; picture-in-picture; storage-access; web-share'

export type IframeHostChat = Pick<GroupChat, 'id' | 'name' | 'roleIds'>
export type IframeHostRole = Pick<GroupRole, 'id' | 'chatId' | 'name' | 'chatSite' | 'geminiConversationUrl' | 'chatGptGptsUrl' | 'grokProjectUrl'>

export interface FrameAssignmentMessage {
  type: typeof FRAME_ASSIGN_MESSAGE
  chatId: string
  roleId: string
  hostTabId?: number
}

export type RoleFrameStatus = 'loading' | 'assigned'

export interface RoleFrameState {
  chatId: string
  roleId: string
  src: string
  active: boolean
  status: RoleFrameStatus
  assignmentAttempts: number
  lastAssignedAt?: number
}

export interface ChatFrameGroupState {
  chatId: string
  active: boolean
  roleIds: string[]
}

export type IframeHostEvent =
  | { type: 'disabled' }
  | { type: 'enabled' }
  | { type: 'chat-activated'; chatId: string }
  | { type: 'group-created'; chatId: string; group: HTMLElement }
  | { type: 'group-highlighted'; chatId: string }
  | { type: 'group-preserved'; chatId: string }
  | { type: 'role-created'; chatId: string; roleId: string; iframe: HTMLIFrameElement; srcKind: 'conversation' | 'site-home' }
  | { type: 'role-reused'; chatId: string; roleId: string; iframe: HTMLIFrameElement }
  | { type: 'role-recovered'; chatId: string; roleId: string; iframe: HTMLIFrameElement }
  | { type: 'role-assigned'; chatId: string; roleId: string; attempts: number }
  | { type: 'role-ready'; chatId: string; roleId: string }
  | { type: 'role-disposed'; chatId: string; roleId: string }
  | { type: 'disposed' }

export interface IframeHostOptions {
  visibleHost: HTMLElement
  hiddenHost?: HTMLElement
  document?: Document
  window?: Window
  assignIntervalMs?: number
  hostTabId?: number
  onEvent?: (event: IframeHostEvent) => void
}

interface RoleFrameRecord {
  chatId: string
  roleId: string
  roleName: string
  roleSite?: ChatSite
  shell: HTMLElement
  label: HTMLElement
  iframe: HTMLIFrameElement
  src: string
  status: RoleFrameStatus
  assignmentAttempts: number
  assignTimer?: number
  lastAssignedAt?: number
}

const DEFAULT_ASSIGN_INTERVAL_MS = 1000

export class IframeHost {
  private readonly visibleHost: HTMLElement
  private readonly document: Document
  private readonly window: Window
  private readonly assignIntervalMs: number
  private readonly onEvent?: (event: IframeHostEvent) => void
  private readonly groupsByChatId = new Map<string, HTMLElement>()
  private readonly framesByRoleKey = new Map<string, RoleFrameRecord>()
  private activeChatId?: string
  private activeChatSignature?: string
  private hostTabId?: number
  private disposed = false
  private enabled = true

  constructor(options: IframeHostOptions) {
    this.visibleHost = options.visibleHost
    this.document = options.document ?? options.visibleHost.ownerDocument
    this.window = options.window ?? this.document.defaultView ?? window
    this.assignIntervalMs = options.assignIntervalMs ?? DEFAULT_ASSIGN_INTERVAL_MS
    this.hostTabId = options.hostTabId
    this.onEvent = options.onEvent
    this.visibleHost.dataset.openteamIframeHost = 'true'
    options.hiddenHost?.remove()
  }

  setHostTabId(hostTabId: number | undefined): void {
    this.hostTabId = hostTabId
  }

  setEnabled(enabled: boolean): void {
    this.assertNotDisposed()
    if (this.enabled === enabled) return

    this.enabled = enabled
    if (!enabled) this.clearFrames()
    this.emit({ type: enabled ? 'enabled' : 'disabled' })
  }

  getActiveChatId(): string | undefined {
    return this.activeChatId
  }

  isChatActive(chatId: string): boolean {
    return this.activeChatId === chatId
  }

  isChatActivated(chatId: string): boolean {
    return this.groupsByChatId.has(chatId)
  }

  hasRoleFrame(chatId: string, roleId: string): boolean {
    return this.framesByRoleKey.has(roleKey(chatId, roleId))
  }

  getRoleFrame(chatId: string, roleId: string): HTMLIFrameElement | undefined {
    return this.framesByRoleKey.get(roleKey(chatId, roleId))?.iframe
  }

  focusRoleFrame(chatId: string, roleId: string): boolean {
    this.assertNotDisposed()
    const record = this.framesByRoleKey.get(roleKey(chatId, roleId))
    if (!record) return false

    this.activeChatId = chatId
    this.activeChatSignature = undefined
    this.highlightChatGroup(chatId)
    this.preserveOtherChatGroups(chatId)
    record.shell.classList.remove('jump-highlight')
    void record.shell.offsetWidth
    record.shell.classList.add('jump-highlight')
    this.window.setTimeout(() => {
      if (record.shell.isConnected) record.shell.classList.remove('jump-highlight')
    }, 2200)
    record.shell.scrollIntoView({ block: 'center', behavior: 'smooth' })
    record.iframe.focus()
    return true
  }

  getChatGroup(chatId: string): HTMLElement | undefined {
    return this.groupsByChatId.get(chatId)
  }

  listChatGroups(): ChatFrameGroupState[] {
    return [...this.groupsByChatId.values()].map(group => {
      const chatId = group.dataset.chatId ?? ''
      return {
        chatId,
        active: this.isChatActive(chatId),
        roleIds: [...group.querySelectorAll<HTMLIFrameElement>('iframe[data-role-id]')].map(iframe => iframe.dataset.roleId ?? '').filter(Boolean),
      }
    })
  }

  getChatState(chatId: string): RoleFrameState[] {
    return [...this.framesByRoleKey.values()]
      .filter(record => record.chatId === chatId)
      .map(record => this.toState(record))
  }

  removeChat(chatId: string): void {
    this.assertNotDisposed()
    if (!this.enabled) return
    for (const record of [...this.framesByRoleKey.values()]) {
      if (record.chatId !== chatId) continue
      this.stopAssignLoop(record)
      record.shell.remove()
      this.framesByRoleKey.delete(roleKey(record.chatId, record.roleId))
      this.emit({ type: 'role-disposed', chatId: record.chatId, roleId: record.roleId })
    }
    this.groupsByChatId.get(chatId)?.remove()
    this.groupsByChatId.delete(chatId)
    if (this.activeChatId === chatId) {
      this.activeChatId = undefined
      this.activeChatSignature = undefined
    }
  }

  activateChat(chat: IframeHostChat, roles: IframeHostRole[]): RoleFrameState[] {
    this.assertNotDisposed()
    if (!this.enabled) return []
    const activationSignature = chatActivationSignature(chat, roles)
    if (this.activeChatId === chat.id && this.activeChatSignature === activationSignature) {
      return this.getChatState(chat.id)
    }

    const group = this.getOrCreateChatGroup(chat)
    this.activeChatId = chat.id
    this.activeChatSignature = activationSignature

    const chatRoleIds = new Set(chat.roleIds)
    this.removeStaleRoleFrames(chat.id, chatRoleIds)
    for (const role of roles) {
      if (role.chatId === chat.id && chatRoleIds.has(role.id)) {
        const record = this.ensureRoleFrame(role)
        this.mountRole(record, group)
      }
    }

    this.highlightChatGroup(chat.id)
    this.preserveOtherChatGroups(chat.id)
    this.scrollChatGroupIntoView(group)
    this.emit({ type: 'chat-activated', chatId: chat.id })
    return this.getChatState(chat.id)
  }

  restoreChat(chat: IframeHostChat, roles: IframeHostRole[]): RoleFrameState[] {
    this.assertNotDisposed()
    if (!this.enabled) return []
    this.activeChatSignature = undefined
    const group = this.getOrCreateChatGroup(chat)
    const chatRoleIds = new Set(chat.roleIds)
    this.removeStaleRoleFrames(chat.id, chatRoleIds)
    for (const role of roles) {
      if (role.chatId === chat.id && chatRoleIds.has(role.id)) {
        const record = this.ensureRoleFrame(role)
        this.mountRole(record, group)
      }
    }

    if (this.isChatActive(chat.id)) this.highlightChatGroup(chat.id)
    else this.preserveChatGroup(chat.id)
    return this.getChatState(chat.id)
  }

  recoverRole(role: IframeHostRole): RoleFrameState {
    this.assertNotDisposed()
    if (!this.enabled) return disabledRoleFrameState(role)
    this.activeChatSignature = undefined
    const group = this.getOrCreateChatGroup(role.chatId)
    const key = roleKey(role.chatId, role.id)
    const existing = this.framesByRoleKey.get(key)
    if (existing) {
      this.stopAssignLoop(existing)
      existing.shell.remove()
      this.framesByRoleKey.delete(key)
    }

    const record = this.createRoleFrame(role)
    this.mountRole(record, group)
    this.emit({ type: 'role-recovered', chatId: role.chatId, roleId: role.id, iframe: record.iframe })
    return this.toState(record)
  }

  markRoleReady(chatId: string, roleId: string): void {
    const record = this.framesByRoleKey.get(roleKey(chatId, roleId))
    if (!record) return

    record.status = 'assigned'
    this.stopAssignLoop(record)
    this.emit({ type: 'role-ready', chatId, roleId })
  }

  hideActiveChat(): void {
    if (!this.activeChatId) return

    const chatId = this.activeChatId
    this.activeChatId = undefined
    this.activeChatSignature = undefined
    this.preserveChatGroup(chatId)
  }

  dispose(): void {
    if (this.disposed) return

    this.clearFrames()
    this.disposed = true
    this.emit({ type: 'disposed' })
  }

  private clearFrames(): void {
    for (const record of this.framesByRoleKey.values()) {
      this.stopAssignLoop(record)
      record.shell.remove()
      this.emit({ type: 'role-disposed', chatId: record.chatId, roleId: record.roleId })
    }
    this.framesByRoleKey.clear()
    for (const group of this.groupsByChatId.values()) group.remove()
    this.groupsByChatId.clear()
    this.activeChatId = undefined
    this.activeChatSignature = undefined
  }

  private ensureRoleFrame(role: IframeHostRole): RoleFrameRecord {
    const key = roleKey(role.chatId, role.id)
    const existing = this.framesByRoleKey.get(key)
    if (existing) {
      this.updateRoleFrameLabel(existing, role)
      this.emit({ type: 'role-reused', chatId: role.chatId, roleId: role.id, iframe: existing.iframe })
      return existing
    }
    return this.createRoleFrame(role)
  }

  private createRoleFrame(role: IframeHostRole): RoleFrameRecord {
    const shell = this.document.createElement('section')
    shell.className = 'role-frame-shell'
    shell.dataset.chatId = role.chatId
    shell.dataset.roleId = role.id
    shell.dataset.roleKey = roleKey(role.chatId, role.id)

    const label = this.document.createElement('div')
    label.className = 'role-frame-label'
    this.renderRoleFrameLabel(label, role)

    const src = getSafeSupportedChatIframeSrcForRole(role.geminiConversationUrl, role)
    const iframe = this.document.createElement('iframe')
    iframe.className = 'role-frame'
    iframe.title = `${role.name} ${siteLabel(role.chatSite)} chat`
    iframe.allow = CHAT_IFRAME_ALLOW
    iframe.dataset.chatId = role.chatId
    iframe.dataset.roleId = role.id
    iframe.dataset.roleKey = roleKey(role.chatId, role.id)
    iframe.setAttribute('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
    iframe.setAttribute('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8')
    iframe.setAttribute('sec-ch-ua', '"Chromium";v="122", "Google Chrome";v="122"')
    iframe.setAttribute('sec-ch-ua-mobile', '?0')
    iframe.setAttribute('sec-ch-ua-platform', '"Macintosh"')

    const record: RoleFrameRecord = {
      chatId: role.chatId,
      roleId: role.id,
      roleName: role.name,
      roleSite: role.chatSite,
      shell,
      label,
      iframe,
      src,
      status: 'loading',
      assignmentAttempts: 0,
    }

    iframe.addEventListener('load', () => this.startAssignLoop(record))
    iframe.src = src
    shell.append(label, iframe)
    this.framesByRoleKey.set(roleKey(role.chatId, role.id), record)
    this.emit({
      type: 'role-created',
      chatId: role.chatId,
      roleId: role.id,
      iframe,
      srcKind: src === getSafeSupportedChatIframeSrcForRole(undefined, role) ? 'site-home' : 'conversation',
    })
    return record
  }

  private removeStaleRoleFrames(chatId: string, activeRoleIds: Set<string>): void {
    for (const record of [...this.framesByRoleKey.values()]) {
      if (record.chatId !== chatId || activeRoleIds.has(record.roleId)) continue
      this.removeRoleFrame(record)
    }
  }

  private removeRoleFrame(record: RoleFrameRecord): void {
    this.stopAssignLoop(record)
    record.shell.remove()
    this.framesByRoleKey.delete(roleKey(record.chatId, record.roleId))
    this.emit({ type: 'role-disposed', chatId: record.chatId, roleId: record.roleId })
  }

  private getOrCreateChatGroup(chat: IframeHostChat | string): HTMLElement {
    const chatId = typeof chat === 'string' ? chat : chat.id
    const existing = this.groupsByChatId.get(chatId)
    if (existing) {
      const chatName = typeof chat === 'string' ? existing.querySelector<HTMLElement>('.chat-frame-group-title')?.textContent || chat : chat.name
      this.updateChatGroupTitle(existing, chatName)
      existing.setAttribute('aria-label', `AI iframe group for ${chatName}`)
      return existing
    }
    const chatName = typeof chat === 'string' ? chat : chat.name

    const group = this.document.createElement('section')
    group.className = 'chat-frame-group'
    group.dataset.chatFrameGroup = 'true'
    group.dataset.chatId = chatId
    group.dataset.backgroundChat = 'true'
    group.setAttribute('aria-label', `AI iframe group for ${chatName}`)
    const title = this.document.createElement('div')
    title.className = 'chat-frame-group-title'
    group.append(title)
    this.updateChatGroupTitle(group, chatName)
    this.visibleHost.append(group)
    this.groupsByChatId.set(chatId, group)
    this.emit({ type: 'group-created', chatId, group })
    return group
  }

  private highlightChatGroup(chatId: string): void {
    const group = this.getOrCreateChatGroup(chatId)
    group.classList.add('active')
    group.classList.remove('background')
    group.dataset.activeChat = 'true'
    delete group.dataset.backgroundChat
    this.emit({ type: 'group-highlighted', chatId })
  }

  private preserveOtherChatGroups(activeChatId: string): void {
    for (const chatId of this.groupsByChatId.keys()) {
      if (chatId !== activeChatId) this.preserveChatGroup(chatId)
    }
  }

  private preserveChatGroup(chatId: string): void {
    const group = this.groupsByChatId.get(chatId)
    if (!group) return

    group.classList.remove('active')
    group.classList.add('background')
    delete group.dataset.activeChat
    group.dataset.backgroundChat = 'true'
    this.emit({ type: 'group-preserved', chatId })
  }

  private scrollChatGroupIntoView(group: HTMLElement): void {
    if (typeof group.scrollIntoView !== 'function') return
    group.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  private mountRole(record: RoleFrameRecord, group: HTMLElement): void {
    if (record.shell.parentElement !== group) group.append(record.shell)
  }

  private startAssignLoop(record: RoleFrameRecord): void {
    if (!this.enabled) return
    if (this.framesByRoleKey.get(roleKey(record.chatId, record.roleId)) !== record) return
    if (record.status === 'assigned') return

    this.stopAssignLoop(record)
    this.assignRole(record)
    record.assignTimer = this.window.setInterval(() => this.assignRole(record), this.assignIntervalMs)
  }

  private stopAssignLoop(record: RoleFrameRecord): void {
    if (record.assignTimer === undefined) return

    this.window.clearInterval(record.assignTimer)
    record.assignTimer = undefined
  }

  private assignRole(record: RoleFrameRecord): void {
    if (!this.enabled) return
    if (this.framesByRoleKey.get(roleKey(record.chatId, record.roleId)) !== record) return
    record.assignmentAttempts += 1
    record.lastAssignedAt = Date.now()
    try {
      record.iframe.contentWindow?.postMessage({
        type: FRAME_ASSIGN_MESSAGE,
        chatId: record.chatId,
        roleId: record.roleId,
        hostTabId: this.hostTabId,
      } satisfies FrameAssignmentMessage, getSupportedChatOrigin(record.src))
    } catch {
      return
    }
    this.emit({ type: 'role-assigned', chatId: record.chatId, roleId: record.roleId, attempts: record.assignmentAttempts })
  }

  private toState(record: RoleFrameRecord): RoleFrameState {
    return {
      chatId: record.chatId,
      roleId: record.roleId,
      src: record.src,
      active: this.isChatActive(record.chatId),
      status: record.status,
      assignmentAttempts: record.assignmentAttempts,
      lastAssignedAt: record.lastAssignedAt,
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('IframeHost has been disposed')
  }

  private updateChatGroupTitle(group: HTMLElement, title: string): void {
    let titleEl = group.querySelector<HTMLElement>('.chat-frame-group-title')
    if (!titleEl) {
      titleEl = this.document.createElement('div')
      titleEl.className = 'chat-frame-group-title'
      group.prepend(titleEl)
    }
    if (titleEl.textContent === title) return
    titleEl.textContent = title
  }

  private updateRoleFrameLabel(record: RoleFrameRecord, role: IframeHostRole): void {
    if (
      record.roleName === role.name &&
      record.roleSite === role.chatSite &&
      record.label.querySelector('.role-frame-name')?.textContent === role.name &&
      record.label.querySelector('.role-frame-site')?.textContent === siteLabel(role.chatSite)
    ) return
    record.roleName = role.name
    record.roleSite = role.chatSite
    this.renderRoleFrameLabel(record.label, role)
    record.iframe.title = `${role.name} ${siteLabel(role.chatSite)} chat`
  }

  private renderRoleFrameLabel(label: HTMLElement, role: IframeHostRole): void {
    const name = this.document.createElement('span')
    name.className = 'role-frame-name'
    name.textContent = role.name
    const site = this.document.createElement('span')
    site.className = `role-frame-site site-pill-${role.chatSite ?? 'gemini'}`
    site.textContent = siteLabel(role.chatSite)
    label.replaceChildren(name, site)
  }

  private emit(event: IframeHostEvent): void {
    this.onEvent?.(event)
  }
}

export function createIframeHost(options: IframeHostOptions): IframeHost {
  return new IframeHost(options)
}

function roleKey(chatId: string, roleId: string): string {
  return `${chatId}:${roleId}`
}

function chatActivationSignature(chat: IframeHostChat, roles: IframeHostRole[]): string {
  const roleIds = new Set(chat.roleIds)
  const roleSignature = roles
    .filter(role => role.chatId === chat.id && roleIds.has(role.id))
    .map(role => `${role.id}:${role.name}:${role.chatSite ?? ''}:${role.geminiConversationUrl ?? ''}:${role.chatGptGptsUrl ?? ''}:${role.grokProjectUrl ?? ''}`)
    .sort()
    .join('|')
  return `${chat.id}:${chat.name}:${chat.roleIds.join(',')}:${roleSignature}`
}

function siteLabel(site: ChatSite | undefined): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  if (site === 'qwen') return 'Qwen'
  return 'Gemini'
}

function disabledRoleFrameState(role: IframeHostRole): RoleFrameState {
  return {
    chatId: role.chatId,
    roleId: role.id,
    src: getSafeSupportedChatIframeSrcForRole(role.geminiConversationUrl, role),
    active: false,
    status: 'loading',
    assignmentAttempts: 0,
  }
}
