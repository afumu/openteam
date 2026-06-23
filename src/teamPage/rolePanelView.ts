import { roleMentionLabel, roleMentionLabelOptionsFromSettings } from '../group/mentionParser'
import type { ChatSite, ExternalModelConfig, GroupRole, OpenTeamStore, RoleModelSource, RoleStatus } from '../group/types'
import { normalizeLanguage, translateUi } from '../shared/i18n'
import type { TeamPageState } from './appState'

const VISIBLE_CHAT_SITES = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok', 'qwen'] as const

interface RolePanelIframeHost {
  recoverRole(role: GroupRole): void
}

export interface RolePanelViewDependencies {
  state: TeamPageState
  getStore(): OpenTeamStore
  rolePanelEl: HTMLElement
  roleSummaryEl: HTMLElement
  roleListEl: HTMLElement
  iframeHost: RolePanelIframeHost
  getCurrentChat(): unknown
  getCurrentRoles(): GroupRole[]
  emptyCard(title: string, body: string): HTMLElement
  roleToneClass(seed: string | undefined): string
  roleAvatarLabel(name: string | undefined): string
  insertMention(role: GroupRole): void
  refreshCurrentChat(): Promise<void>
  focusRoleFrame(chatId: string, roleId: string | undefined): void
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
}

export interface RolePanelView {
  renderRolePanel(): void
}

export function createRolePanelView(deps: RolePanelViewDependencies): RolePanelView {
  function renderRolePanel(): void {
    const roles = deps.getCurrentRoles()
    const store = deps.getStore()
    const selectedRole = deps.state.selectedRoleId ? store.rolesById[deps.state.selectedRoleId] : undefined
    deps.rolePanelEl.classList.toggle('open', deps.state.peopleDrawerOpen)
    deps.roleSummaryEl.textContent = ui(`${roles.length} 人员${selectedRole ? ` · 当前：${selectedRole.name}` : ''}`)
    renderRolePanelActions()
    deps.roleListEl.replaceChildren()

    if (!deps.getCurrentChat()) {
      deps.roleListEl.append(deps.emptyCard(ui('未选择群聊'), ui('选择群聊后可添加、查看、恢复和唤醒人员。')))
    } else if (roles.length === 0) {
      deps.roleListEl.append(deps.emptyCard(ui('暂无人员'), ui('点击添加人员，可从人员库批量加入或临时添加。')))
    } else {
      for (const role of roles) deps.roleListEl.append(roleCard(role))
    }
  }

  function roleCard(role: GroupRole): HTMLElement {
    const card = document.createElement('section')
    card.className = `role-card${role.id === deps.state.selectedRoleId ? ' active' : ''}`
    card.addEventListener('click', () => {
      deps.state.selectedRoleId = role.id
      deps.state.roleSiteMenuRoleId = undefined
      deps.state.roleActionMenuRoleId = undefined
      renderRolePanel()
    })

    const avatar = document.createElement('div')
    avatar.className = `role-avatar ${deps.roleToneClass(role.name)}`
    avatar.textContent = deps.roleAvatarLabel(role.name)
    wireMentionShortcut(avatar, role)

    const main = document.createElement('div')
    main.className = 'role-card-main'

    const row = document.createElement('div')
    row.className = 'role-row'
    const name = document.createElement('div')
    name.className = 'role-name'
    name.textContent = role.name
    wireMentionShortcut(name, role)
    row.append(name, statusPill(role.status, ui(roleStatusLabel(role.status))))

    const description = document.createElement('div')
    description.className = 'role-description'
    description.textContent = role.description || ui('未填写人员描述')

    const meta = document.createElement('div')
    meta.className = 'chat-row tiny role-meta'
    meta.append(roleSiteControl(role), roleContextProgress(role, ui), roleConnectionStatus(role, ui))
    main.append(row, description, meta)

    const actions = document.createElement('div')
    actions.className = 'role-card-actions'
    const promptDetail = rolePromptDetailButton(role)
    const refresh = roleRefreshButton(role)
    const jump = roleJumpButton(role)
    const remove = roleDeleteButton(role)
    actions.append(promptDetail, refresh, jump, remove)
    card.append(avatar, main, actions)

    if (role.status === 'error') {
      const error = document.createElement('div')
      error.className = 'reference-box'
      error.textContent = ui('人员异常。若目标站点未登录，请打开登录页后点击恢复人员。')
      main.append(error)
    }
    return card
  }

  function rolePromptDetailButton(role: GroupRole): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'role-prompt-detail'
    button.dataset.rolePromptDetail = role.id
    button.setAttribute('aria-label', language() === 'en' ? `View ${role.name}'s prompt` : `查看 ${role.name} 的提示词`)
    button.title = ui('查看提示词')
    button.append(promptDetailIcon())
    button.addEventListener('click', event => {
      event.stopPropagation()
      openRolePromptDetail(role)
    })
    return button
  }

  function openRolePromptDetail(role: GroupRole): void {
    document.querySelector('.role-prompt-modal')?.remove()

    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop role-prompt-modal'
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) backdrop.remove()
    })

    const modal = document.createElement('section')
    modal.className = 'modal template-detail-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'role-prompt-detail-title')
    modal.addEventListener('click', event => event.stopPropagation())

    const header = document.createElement('div')
    header.className = 'modal-header'
    const copy = document.createElement('div')
    const title = document.createElement('h2')
    title.id = 'role-prompt-detail-title'
    title.textContent = role.name
    const description = document.createElement('p')
    description.className = 'tiny'
    description.textContent = role.description || ui('未填写人员描述')
    copy.append(title, description)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'icon-btn modal-close role-prompt-close'
    close.setAttribute('aria-label', ui('关闭提示词详情'))
    close.textContent = '×'
    close.addEventListener('click', () => backdrop.remove())
    header.append(copy, close)

    const prompt = document.createElement('pre')
    prompt.className = 'template-prompt-preview'
    prompt.textContent = role.systemPrompt?.trim() || ui('未填写提示词')

    modal.append(header, prompt)
    backdrop.append(modal)
    document.body.append(backdrop)
    close.focus()
  }

  function renderRolePanelActions(): void {
    const header = deps.roleSummaryEl.parentElement?.parentElement
    if (!header) return
    let actions = header.querySelector<HTMLElement>('.role-panel-actions')
    if (!actions) {
      actions = document.createElement('div')
      actions.className = 'role-panel-actions'
      const login = header.querySelector('#open-gemini-login')
      if (login) {
        header.insertBefore(actions, login)
        actions.append(login)
      } else {
        header.append(actions)
      }
    }
  }

  function roleRefreshButton(role: GroupRole): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'role-refresh'
    button.dataset.roleRefresh = role.id
    button.setAttribute('aria-label', language() === 'en' ? `Refresh ${role.name}'s member window` : `刷新 ${role.name} 的成员窗口`)
    button.title = role.modelSource === 'external' ? ui('API 成员无需刷新窗口') : ui('刷新成员窗口')
    button.textContent = '↻'
    if (role.modelSource === 'external') button.disabled = true
    button.addEventListener('click', event => {
      event.stopPropagation()
      if (role.modelSource === 'external') return
      deps.iframeHost.recoverRole(role)
      deps.runCommand('GROUP_ROLE_RECOVER', { chatId: role.chatId, roleId: role.id })
        .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
    return button
  }

  function roleJumpButton(role: GroupRole): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'role-jump'
    button.setAttribute('aria-label', language() === 'en' ? `Jump to ${role.name}'s source window` : `跳转到 ${role.name} 的原始窗口`)
    button.title = ui('跳转到原始窗口')
    button.textContent = '↗'
    button.addEventListener('click', event => {
      event.stopPropagation()
      deps.focusRoleFrame(role.chatId, role.id)
    })
    return button
  }

  function roleDeleteButton(role: GroupRole): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'role-delete'
    button.dataset.roleDelete = role.id
    button.setAttribute('aria-label', language() === 'en' ? `Delete ${role.name}` : `删除 ${role.name}`)
    button.title = ui('删除成员')
    button.append(trashIcon())
    button.addEventListener('click', event => {
      event.stopPropagation()
      deps.state.roleSiteMenuRoleId = undefined
      deps.state.roleActionMenuRoleId = undefined
      kickRoleFromChat(role).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
    return button
  }

  function roleSiteControl(role: GroupRole): HTMLElement {
    const control = document.createElement('div')
    control.className = 'role-site-control'
    const sitePill = document.createElement('button')
    sitePill.type = 'button'
    const model = roleModelOption(role, deps.getStore())
    sitePill.className = `site-pill ${model.className}`
    sitePill.setAttribute('aria-expanded', String(deps.state.roleSiteMenuRoleId === role.id))
    sitePill.textContent = model.label
    sitePill.addEventListener('click', event => {
      event.stopPropagation()
      deps.state.roleActionMenuRoleId = undefined
      deps.state.roleSiteMenuRoleId = deps.state.roleSiteMenuRoleId === role.id ? undefined : role.id
      renderRolePanel()
    })
    control.append(sitePill)
    if (deps.state.roleSiteMenuRoleId === role.id) control.append(roleSiteMenu(role))
    return control
  }

  function roleSiteMenu(role: GroupRole): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'role-site-menu'
    menu.addEventListener('click', event => event.stopPropagation())
    for (const model of selectableModels(deps.getStore())) {
      const option = document.createElement('button')
      option.type = 'button'
      const active = roleModelKey(role, deps.getStore()) === model.key
      option.className = `role-site-option${active ? ' active' : ''}`
      option.textContent = active ? `✓ ${model.label}` : model.label
      option.addEventListener('click', () => {
        deps.state.roleSiteMenuRoleId = undefined
        if (active) {
          renderRolePanel()
          return
        }
        switchRoleSite(role, model.key).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
      })
      menu.append(option)
    }
    return menu
  }

  async function kickRoleFromChat(role: GroupRole): Promise<void> {
    if (!window.confirm(`确定将「${role.name}」移出当前群聊吗？历史聊天记录会保留。`)) {
      renderRolePanel()
      return
    }
    await deps.runCommand('GROUP_ROLE_DELETE', { roleId: role.id })
  }

  async function switchRoleSite(role: GroupRole, modelKey: string): Promise<void> {
    if (roleModelKey(role, deps.getStore()) === modelKey) return
    const patch = rolePatchForModelKey(modelKey)
    await deps.runCommand('GROUP_ROLE_UPDATE', { roleId: role.id, patch })
    const updatedRole = deps.getStore().rolesById[role.id]
    if (!updatedRole) return
    if (updatedRole.modelSource === 'external') return
    deps.iframeHost.recoverRole(updatedRole)
    await deps.runCommand('GROUP_ROLE_RECOVER', { chatId: updatedRole.chatId, roleId: updatedRole.id })
  }

  return { renderRolePanel }

  function language() {
    return normalizeLanguage(deps.getStore().settings.language)
  }

  function ui(source: string): string {
    return translateUi(source, language())
  }

  function wireMentionShortcut(element: HTMLElement, role: GroupRole): void {
    element.classList.add('mention-shortcut')
    element.title = `@${roleMentionLabel(role, roleMentionLabelOptionsFromSettings(deps.getStore().settings))}`
    element.addEventListener('click', event => {
      event.stopPropagation()
      deps.insertMention(role)
    })
    element.addEventListener('contextmenu', event => {
      event.preventDefault()
      event.stopPropagation()
      deps.insertMention(role)
    })
  }
}

function trashIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M9 4h6l1 2h4v2H4V6h4l1-2Zm-2 6h10l-.7 9.1A2 2 0 0 1 14.3 21H9.7a2 2 0 0 1-2-1.9L7 10Zm3 2v6h1.6v-6H10Zm2.4 0v6H14v-6h-1.6Z')
  svg.append(path)
  return svg
}

function promptDetailIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  const page = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  page.setAttribute('d', 'M7 3.8h6.4L17 7.4V20H7V3.8Z')
  const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  fold.setAttribute('d', 'M13.2 4v3.6h3.6')
  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line1.setAttribute('d', 'M9.6 11h4.8')
  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line2.setAttribute('d', 'M9.6 14h4.8')
  const line3 = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line3.setAttribute('d', 'M9.6 17h2.8')

  svg.append(page, fold, line1, line2, line3)
  return svg
}

function siteLabel(site: ChatSite | undefined): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  if (site === 'qwen') return 'Qwen'
  return 'Gemini'
}

function selectableModels(store: OpenTeamStore): Array<{ key: string; label: string; className: string }> {
  return [
    ...VISIBLE_CHAT_SITES.map(site => ({ key: modelKeyForSite(site), label: siteLabel(site), className: `site-pill-${site}` })),
    ...externalModels(store).map(model => ({ key: modelKeyForExternal(model.id), label: `API · ${model.name}`, className: 'site-pill-external' })),
  ]
}

function roleModelOption(role: GroupRole, store: OpenTeamStore): { key: string; label: string; className: string } {
  const key = roleModelKey(role, store)
  return selectableModels(store).find(model => model.key === key) ?? { key, label: 'API · 未配置', className: 'site-pill-external' }
}

function roleModelKey(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): string {
  if (role.modelSource === 'external' && role.externalModelId) return modelKeyForExternal(role.externalModelId)
  return modelKeyForSite(role.chatSite ?? store.settings.defaultChatSite)
}

function rolePatchForModelKey(key: string): { modelSource: RoleModelSource; chatSite?: ChatSite; externalModelId?: string } {
  const externalModelId = key.startsWith('external:') ? key.slice('external:'.length) : ''
  if (externalModelId) return { modelSource: 'external', externalModelId }
  return { modelSource: 'site', chatSite: visibleChatSite(key.startsWith('site:') ? key.slice('site:'.length) : key) }
}

function externalModels(store: OpenTeamStore): ExternalModelConfig[] {
  return store.settings.externalModelOrder
    .map(modelId => store.settings.externalModelsById[modelId])
    .filter((model): model is ExternalModelConfig => Boolean(model))
}

function modelKeyForSite(site: ChatSite): string {
  return `site:${site}`
}

function modelKeyForExternal(modelId: string): string {
  return `external:${modelId}`
}

function visibleChatSite(value: string | undefined): ChatSite {
  return value === 'chatgpt' || value === 'claude' || value === 'deepseek' || value === 'grok' ? value : 'gemini'
}

function statusPill(status: string, label: string): HTMLElement {
  const pill = document.createElement('span')
  pill.className = `status-pill status-${status}`
  pill.textContent = label
  return pill
}

function roleContextProgress(role: GroupRole, ui: (source: string) => string): HTMLElement {
  const progress = document.createElement('span')
  progress.className = 'role-meta-item'
  progress.textContent = ui(role.contextCursor > 0 ? `已读 ${role.contextCursor} 条` : '尚未读取消息')
  return progress
}

function roleConnectionStatus(role: GroupRole, ui: (source: string) => string): HTMLElement {
  const status = document.createElement('span')
  status.className = 'role-meta-item'
  status.textContent = ui(role.modelSource === 'external' ? '连接 API' : role.geminiConversationUrl ? '网页已连接' : '等待连接')
  return status
}

function roleStatusLabel(status: RoleStatus): string {
  const labels: Record<RoleStatus, string> = {
    pending: '待唤醒',
    loading: '加载中',
    ready: '在线',
    thinking: '回复中',
    stopped: '已停止',
    error: '异常',
  }
  return labels[status]
}
