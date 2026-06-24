// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import { createTeamPageState } from './appState'
import { createRolePanelView } from './rolePanelView'

describe('team page role panel view boundary', () => {
  it('keeps role panel rendering and role site switching outside the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/rolePanelView.ts'), 'utf8')

    expect(viewSource).toContain('function renderRolePanel(): void')
    expect(viewSource).toContain('function roleCard(role: GroupRole): HTMLElement')
    expect(viewSource).toContain('function roleSiteControl(role: GroupRole): HTMLElement')
    expect(viewSource).toContain('function roleSiteMenu(role: GroupRole): HTMLElement')
    expect(viewSource).toContain('function roleDeleteButton(role: GroupRole): HTMLButtonElement')
    expect(viewSource).toContain('function kickRoleFromChat(role: GroupRole): Promise<void>')
    expect(viewSource).toContain('function switchRoleSite(role: GroupRole, modelKey: string): Promise<void>')
    expect(viewSource).toContain('function roleRefreshButton(role: GroupRole): HTMLButtonElement')
    expect(viewSource).toContain('function roleJumpButton(role: GroupRole): HTMLButtonElement')
    expect(viewSource).not.toContain('function roleListRefreshButton(): HTMLButtonElement')
    expect(viewSource).toContain("deps.iframeHost.recoverRole(role)")
    expect(viewSource).toContain("deps.runCommand('GROUP_ROLE_RECOVER'")
    expect(viewSource).toContain("deps.focusRoleFrame(role.chatId, role.id)")
    expect(viewSource).toContain('deps.state.roleActionMenuRoleId')
    expect(viewSource).toContain('function trashIcon(): SVGSVGElement')
    expect(viewSource).toContain('button.dataset.roleDelete = role.id')
    expect(viewSource).toContain("ready: '在线'")
    expect(viewSource).not.toContain("ready: '就绪'")
    expect(viewSource).toContain('function roleContextProgress(role: GroupRole, ui: (source: string) => string): HTMLElement')
    expect(viewSource).toContain("`已读 ${role.contextCursor} 条`")
    expect(viewSource).toContain("'连接 API'")
    expect(viewSource).toContain("'网页已连接'")
    expect(viewSource).not.toContain("'API 模型'")
    expect(viewSource).not.toContain('cursor ${role.contextCursor}')
    expect(viewSource).not.toContain("'已有会话'")
    expect(viewSource).not.toContain("'未绑定会话'")
    expect(viewSource).toContain("deps.runCommand('GROUP_ROLE_DELETE'")
    expect(roleSiteMenuSource(viewSource)).not.toContain('GROUP_ROLE_DELETE')
    expect(roleSiteMenuSource(viewSource)).not.toContain('删除成员')
    expect(entrySource).not.toContain('function renderRolePanel(): void')
    expect(entrySource).not.toContain('function roleCard(role: GroupRole): HTMLElement')
    expect(entrySource).not.toContain('function roleSiteControl(role: GroupRole): HTMLElement')
    expect(entrySource).not.toContain('function roleSiteMenu(role: GroupRole): HTMLElement')
    expect(entrySource).not.toContain('function roleDeleteButton(role: GroupRole): HTMLButtonElement')
    expect(entrySource).not.toContain('function roleRefreshButton(role: GroupRole): HTMLButtonElement')
    expect(entrySource).not.toContain('function roleJumpButton(role: GroupRole): HTMLButtonElement')
    expect(entrySource).not.toContain('function kickRoleFromChat(role: GroupRole): Promise<void>')
    expect(entrySource).not.toContain('function switchRoleSite(role: GroupRole, chatSite: ChatSite): Promise<void>')
  })

  it('renders a refresh action on each member card and rebuilds only that iframe', async () => {
    const store = makeStoreWithRole()
    const rolePanelEl = document.createElement('aside')
    const roleSummaryEl = document.createElement('p')
    const roleListEl = document.createElement('div')
    const iframeHost = { recoverRole: vi.fn() }
    const runCommand = vi.fn(async () => undefined)
    rolePanelEl.append(roleSummaryEl, roleListEl)

    const view = createRolePanelView({
      state: createTeamPageState(),
      getStore: () => store,
      rolePanelEl,
      roleSummaryEl,
      roleListEl,
      iframeHost,
      getCurrentChat: () => store.chatsById['chat-1'],
      getCurrentRoles: () => [store.rolesById['role-1']],
      emptyCard: (title, body) => {
        const card = document.createElement('div')
        card.textContent = `${title}${body}`
        return card
      },
      roleToneClass: () => 'role-tone-0',
      roleAvatarLabel: name => name?.slice(0, 1) ?? '',
      insertMention: vi.fn(),
      refreshCurrentChat: vi.fn(async () => undefined),
      focusRoleFrame: vi.fn(),
      runCommand,
      showError: vi.fn(),
    })

    view.renderRolePanel()
    expect(roleListEl.querySelector('[data-role-list-refresh]')).toBeNull()
    const refresh = roleListEl.querySelector<HTMLButtonElement>('[data-role-refresh="role-1"]')
    expect(refresh?.getAttribute('aria-label')).toBe('刷新 产品经理 的成员窗口')
    refresh?.click()
    await Promise.resolve()

    expect(iframeHost.recoverRole).toHaveBeenCalledWith(store.rolesById['role-1'])
    expect(runCommand).toHaveBeenCalledWith('GROUP_ROLE_RECOVER', { chatId: 'chat-1', roleId: 'role-1' })
  })

  it('renders member deletion as a direct icon action and confirms before removing', async () => {
    const store = makeStoreWithRole()
    const rolePanelEl = document.createElement('aside')
    const roleSummaryEl = document.createElement('p')
    const roleListEl = document.createElement('div')
    const iframeHost = { recoverRole: vi.fn() }
    const runCommand = vi.fn(async () => undefined)
    rolePanelEl.append(roleSummaryEl, roleListEl)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const view = createRolePanelView({
      state: createTeamPageState(),
      getStore: () => store,
      rolePanelEl,
      roleSummaryEl,
      roleListEl,
      iframeHost,
      getCurrentChat: () => store.chatsById['chat-1'],
      getCurrentRoles: () => [store.rolesById['role-1']],
      emptyCard: (title, body) => {
        const card = document.createElement('div')
        card.textContent = `${title}${body}`
        return card
      },
      roleToneClass: () => 'role-tone-0',
      roleAvatarLabel: name => name?.slice(0, 1) ?? '',
      insertMention: vi.fn(),
      refreshCurrentChat: vi.fn(async () => undefined),
      focusRoleFrame: vi.fn(),
      runCommand,
      showError: vi.fn(),
    })

    view.renderRolePanel()
    expect(roleListEl.querySelector('.role-more')).toBeNull()
    const remove = roleListEl.querySelector<HTMLButtonElement>('[data-role-delete="role-1"]')
    expect(remove?.querySelector('svg')).not.toBeNull()
    expect(remove?.getAttribute('aria-label')).toBe('删除 产品经理')
    remove?.click()
    await Promise.resolve()

    expect(confirm).toHaveBeenCalledWith('确定将「产品经理」移出当前群聊吗？历史聊天记录会保留。')
    expect(runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-1' })
    confirm.mockRestore()
  })

  it('opens a member prompt detail dialog from the member card', () => {
    const store = makeStoreWithRole()
    store.rolesById['role-1'].description = '拆解需求和验收标准'
    store.rolesById['role-1'].systemPrompt = '你是产品经理。请先澄清目标，再输出可执行方案。'
    const rolePanelEl = document.createElement('aside')
    const roleSummaryEl = document.createElement('p')
    const roleListEl = document.createElement('div')
    rolePanelEl.append(roleSummaryEl, roleListEl)

    const view = createRolePanelView({
      state: createTeamPageState(),
      getStore: () => store,
      rolePanelEl,
      roleSummaryEl,
      roleListEl,
      iframeHost: { recoverRole: vi.fn() },
      getCurrentChat: () => store.chatsById['chat-1'],
      getCurrentRoles: () => [store.rolesById['role-1']],
      emptyCard: (title, body) => {
        const card = document.createElement('div')
        card.textContent = `${title}${body}`
        return card
      },
      roleToneClass: () => 'role-tone-0',
      roleAvatarLabel: name => name?.slice(0, 1) ?? '',
      insertMention: vi.fn(),
      refreshCurrentChat: vi.fn(async () => undefined),
      focusRoleFrame: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    view.renderRolePanel()
    const detail = roleListEl.querySelector<HTMLButtonElement>('[data-role-prompt-detail="role-1"]')
    expect(detail?.getAttribute('aria-label')).toBe('查看 产品经理 的提示词')
    expect(detail?.querySelector('svg')).not.toBeNull()
    expect(detail?.textContent?.trim()).toBe('')
    detail?.click()

    const modal = document.querySelector<HTMLElement>('.role-prompt-modal')
    expect(modal?.hidden).toBe(false)
    expect(modal?.querySelector('h2')?.textContent).toBe('产品经理')
    expect(modal?.textContent).toContain('拆解需求和验收标准')
    expect(modal?.querySelector('pre')?.textContent).toBe('你是产品经理。请先澄清目标，再输出可执行方案。')

    modal?.querySelector<HTMLButtonElement>('.role-prompt-close')?.click()
    expect(document.querySelector('.role-prompt-modal')).toBeNull()
  })

  it('renders the latest AI page health detail on the member card', () => {
    const store = makeStoreWithRole()
    Object.assign(store.rolesById['role-1'], {
      siteHealth: {
        siteId: 'chatgpt',
        status: 'blocked',
        detail: 'Access Denied',
        updatedAt: 100,
      },
    })
    const rolePanelEl = document.createElement('aside')
    const roleSummaryEl = document.createElement('p')
    const roleListEl = document.createElement('div')
    rolePanelEl.append(roleSummaryEl, roleListEl)

    const view = createRolePanelView({
      state: createTeamPageState(),
      getStore: () => store,
      rolePanelEl,
      roleSummaryEl,
      roleListEl,
      iframeHost: { recoverRole: vi.fn() },
      getCurrentChat: () => store.chatsById['chat-1'],
      getCurrentRoles: () => [store.rolesById['role-1']],
      emptyCard: (title, body) => {
        const card = document.createElement('div')
        card.textContent = `${title}${body}`
        return card
      },
      roleToneClass: () => 'role-tone-0',
      roleAvatarLabel: name => name?.slice(0, 1) ?? '',
      insertMention: vi.fn(),
      refreshCurrentChat: vi.fn(async () => undefined),
      focusRoleFrame: vi.fn(),
      runCommand: vi.fn(async () => undefined),
      showError: vi.fn(),
    })

    view.renderRolePanel()

    expect(roleListEl.querySelector('.role-meta')?.textContent).toContain('页面被阻止：Access Denied')
  })
})

function makeStoreWithRole(): OpenTeamStore {
  const store = createDefaultStore()
  store.settings.language = 'zh-CN'
  const chat: GroupChat = {
    id: 'chat-1',
    name: '产品会',
    mode: 'independent',
    roleIds: ['role-1'],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  const role: GroupRole = {
    id: 'role-1',
    chatId: chat.id,
    name: '产品经理',
    status: 'error',
    contextCursor: 0,
    chatSite: 'chatgpt',
    createdAt: 1,
    updatedAt: 1,
  }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.rolesById[role.id] = role
  return store
}

function roleSiteMenuSource(source: string): string {
  const match = source.match(/function roleSiteMenu\(role: GroupRole\): HTMLElement \{(?<body>[\s\S]*?)\n  async function kickRoleFromChat/)
  return match?.groups?.body ?? ''
}
