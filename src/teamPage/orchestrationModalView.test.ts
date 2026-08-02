// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, OrchestrationFlow } from '../group/types'
import { createOrchestrationModalView, orderStagesByGraph } from './orchestrationModalView'

class MockGraph {
  static instances: MockGraph[] = []
  nodes: Array<{ id?: string; data?: Record<string, unknown> }> = []
  clearCalls = 0
  addNodeCalls = 0
  handlers = new Map<string, Array<(args: { node?: { getData(): Record<string, unknown> } }) => void>>()

  static latest(): MockGraph {
    const graph = MockGraph.instances[MockGraph.instances.length - 1]
    if (!graph) throw new Error('MockGraph was not mounted')
    return graph
  }

  constructor(public options: Record<string, unknown>) {
    MockGraph.instances.push(this)
  }
  clearCells(): void {
    this.clearCalls += 1
    this.nodes = []
  }
  addNode(node: unknown): unknown {
    this.addNodeCalls += 1
    this.nodes.push(node as { id?: string; data?: Record<string, unknown> })
    return node
  }
  addEdge(edge: unknown): unknown { return edge }
  on(eventName: string, handler: (args: { node?: { getData(): Record<string, unknown> } }) => void): void {
    this.handlers.set(eventName, [...this.handlers.get(eventName) ?? [], handler])
  }
  selectNode(stageId: string): void {
    for (const handler of this.handlers.get('node:click') ?? []) handler({ node: { getData: () => ({ stageId }) } })
  }
  getNodes(): Array<{ getData(): Record<string, unknown>; attr(path: string, value: unknown): void }> {
    return this.nodes.map(node => ({
      getData: () => node.data ?? {},
      attr: vi.fn(),
    }))
  }
  dispose(): void {}
}

interface Harness {
  refs: {
    openOrchestrationEl: HTMLButtonElement
    orchestrationModalEl: HTMLElement
    orchestrationAutoModalEl: HTMLElement
    closeOrchestrationEl: HTMLButtonElement
    orchestrationTaskEl: HTMLTextAreaElement
    autoOrchestrationEl: HTMLButtonElement
    openOrchestrationTemplateEl: HTMLButtonElement
    orchestrationTemplateModalEl: HTMLElement
    closeOrchestrationTemplateEl: HTMLButtonElement
    orchestrationTemplateContentEl: HTMLElement
    closeAutoOrchestrationEl: HTMLButtonElement
    orchestrationAutoContentEl: HTMLElement
    orchestrationPeopleListEl: HTMLElement
    arrangeOrchestrationEl: HTMLButtonElement
    orchestrationCanvasEl: HTMLElement
    orchestrationHintEl: HTMLElement
    orchestrationStageSettingsEl: HTMLElement
    orchestrationReviewSettingsEl: HTMLElement
    orchestrationMaxRoundsEl: HTMLInputElement
    saveOrchestrationEl: HTMLButtonElement
    runOrchestrationEl: HTMLButtonElement
  }
  store: OpenTeamStore
  sendRuntimeMessage: Mock<(type: string, payload?: Record<string, unknown>) => Promise<{ ok?: boolean; store?: OpenTeamStore; flow?: OrchestrationFlow; roles?: GroupRole[]; createdRoleIds?: string[]; reusedRoleIds?: string[] }>>
  runCommand: Mock<(type: string, payload?: Record<string, unknown>) => Promise<void>>
  reconnectRolesForSend: Mock<(chat: GroupChat, roles: GroupRole[]) => Promise<void>>
  openExternalModels: Mock<() => void>
  errors: string[]
  successes: string[]
}

function createHarness(): Harness {
  document.body.innerHTML = `
    <button id="open-orchestration"></button>
    <div id="orchestration-modal" hidden>
      <button id="close-orchestration"></button>
      <textarea id="orchestration-task"></textarea>
      <button id="open-orchestration-template"></button>
      <button id="auto-orchestration"></button>
      <div id="orchestration-people-list"></div>
      <button id="arrange-orchestration"></button>
      <div id="orchestration-stage-canvas"></div>
      <p id="orchestration-empty-hint"></p>
      <div class="orchestration-layout">
        <aside class="orchestration-settings">
          <div id="orchestration-stage-settings"></div>
          <div id="orchestration-review-settings"></div>
        </aside>
      </div>
      <input id="orchestration-max-rounds" />
      <button id="save-orchestration"></button>
      <button id="run-orchestration"></button>
    </div>
    <div id="orchestration-auto-modal" hidden>
      <button id="close-auto-orchestration"></button>
      <div id="orchestration-auto-content"></div>
    </div>
    <div id="orchestration-template-modal" hidden>
      <button id="close-orchestration-template"></button>
      <div id="orchestration-template-content"></div>
    </div>
  `
  const store = createDefaultStore()
  const chat: GroupChat = { id: 'chat-1', name: '测试群聊', mode: 'collaborative', roleIds: ['role-1', 'role-2'], messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
  const roleOne: GroupRole = { id: 'role-1', chatId: 'chat-1', name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  const roleTwo: GroupRole = { id: 'role-2', chatId: 'chat-1', name: '评审', modelSource: 'external', externalModelId: 'model-1', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.rolesById[roleOne.id] = roleOne
  store.rolesById[roleTwo.id] = roleTwo
  store.settings.externalModelOrder = ['model-1']
  store.settings.externalModelsById = {
    'model-1': { id: 'model-1', name: 'OpenRouter Claude', format: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'key', modelName: 'anthropic/claude-sonnet-4', createdAt: 1, updatedAt: 1 },
  }
  return {
    refs: {
      openOrchestrationEl: document.querySelector('#open-orchestration') as HTMLButtonElement,
      orchestrationModalEl: document.querySelector('#orchestration-modal') as HTMLElement,
      orchestrationAutoModalEl: document.querySelector('#orchestration-auto-modal') as HTMLElement,
      closeOrchestrationEl: document.querySelector('#close-orchestration') as HTMLButtonElement,
      orchestrationTaskEl: document.querySelector('#orchestration-task') as HTMLTextAreaElement,
      autoOrchestrationEl: document.querySelector('#auto-orchestration') as HTMLButtonElement,
      openOrchestrationTemplateEl: document.querySelector('#open-orchestration-template') as HTMLButtonElement,
      orchestrationTemplateModalEl: document.querySelector('#orchestration-template-modal') as HTMLElement,
      closeOrchestrationTemplateEl: document.querySelector('#close-orchestration-template') as HTMLButtonElement,
      orchestrationTemplateContentEl: document.querySelector('#orchestration-template-content') as HTMLElement,
      closeAutoOrchestrationEl: document.querySelector('#close-auto-orchestration') as HTMLButtonElement,
      orchestrationAutoContentEl: document.querySelector('#orchestration-auto-content') as HTMLElement,
      orchestrationPeopleListEl: document.querySelector('#orchestration-people-list') as HTMLElement,
      arrangeOrchestrationEl: document.querySelector('#arrange-orchestration') as HTMLButtonElement,
      orchestrationCanvasEl: document.querySelector('#orchestration-stage-canvas') as HTMLElement,
      orchestrationHintEl: document.querySelector('#orchestration-empty-hint') as HTMLElement,
      orchestrationStageSettingsEl: document.querySelector('#orchestration-stage-settings') as HTMLElement,
      orchestrationReviewSettingsEl: document.querySelector('#orchestration-review-settings') as HTMLElement,
      orchestrationMaxRoundsEl: document.querySelector('#orchestration-max-rounds') as HTMLInputElement,
      saveOrchestrationEl: document.querySelector('#save-orchestration') as HTMLButtonElement,
      runOrchestrationEl: document.querySelector('#run-orchestration') as HTMLButtonElement,
    },
    store,
    sendRuntimeMessage: vi.fn<(type: string, payload?: Record<string, unknown>) => Promise<{ ok?: boolean; store?: OpenTeamStore; flow?: OrchestrationFlow; roles?: GroupRole[]; createdRoleIds?: string[]; reusedRoleIds?: string[] }>>(async () => ({ ok: true })),
    runCommand: vi.fn<(type: string, payload?: Record<string, unknown>) => Promise<void>>(async () => undefined),
    reconnectRolesForSend: vi.fn<(chat: GroupChat, roles: GroupRole[]) => Promise<void>>(async () => undefined),
    openExternalModels: vi.fn(),
    errors: [],
    successes: [],
  }
}

function createView(harness: Harness): ReturnType<typeof createOrchestrationModalView> {
  return createOrchestrationModalView({
    ...harness.refs,
    getStore: () => harness.store,
    applyStore: nextStore => {
      harness.store = nextStore
    },
    getCurrentChat: () => harness.store.currentChatId ? harness.store.chatsById[harness.store.currentChatId] : undefined,
    getCurrentRoles: () => harness.store.currentChatId ? harness.store.chatsById[harness.store.currentChatId].roleIds.map(roleId => harness.store.rolesById[roleId]) : [],
    reconnectRolesForSend: harness.reconnectRolesForSend,
    sendRuntimeMessage: harness.sendRuntimeMessage,
    runCommand: harness.runCommand,
    openExternalModels: harness.openExternalModels,
    showError: message => harness.errors.push(message),
    showSuccess: message => harness.successes.push(message),
    loadX6: async () => ({ Graph: MockGraph }),
  })
}

describe('orchestration modal view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    MockGraph.instances = []
  })

  it('opens with drag-only people cards and creates one single-role node per drop without exposing stages', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()

    expect(harness.refs.orchestrationModalEl.hidden).toBe(false)
    expect(harness.refs.orchestrationHintEl.hidden).toBe(false)
    expect(harness.refs.orchestrationMaxRoundsEl.value).toBe('50')
    expect(harness.refs.orchestrationPeopleListEl.textContent).not.toContain('新阶段')
    expect(harness.refs.orchestrationPeopleListEl.textContent).not.toContain('并行加入')
    expect(harness.refs.orchestrationPeopleListEl.textContent).not.toContain('设为审核')
    expect(harness.refs.orchestrationModalEl.textContent).not.toContain('阶段')
    expect([...harness.refs.orchestrationPeopleListEl.querySelectorAll('.site-pill')].map(item => item.textContent)).toEqual(['ChatGPT', 'API · OpenRouter Claude'])

    dropRole(harness, 'role-1')
    dropRole(harness, 'role-2')
    harness.refs.orchestrationTaskEl.value = '完成方案评审'
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    const runPayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_RUN')?.[1] as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.stages.map(stage => stage.roleIds)).toEqual([['role-1'], ['role-2']])
    expect(runPayload.flow?.graph?.edges).toEqual([])
  })

  it('opens orchestration setup without redirecting to external model setup', () => {
    const harness = createHarness()
    harness.store.settings.externalModelOrder = []
    harness.store.settings.externalModelsById = {}
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()

    expect(harness.errors).not.toContain('编排依赖外部模型 API，请先配置一个外部模型。')
    expect(harness.openExternalModels).not.toHaveBeenCalled()
    expect(harness.refs.orchestrationModalEl.hidden).toBe(false)
  })

  it('prompts users to configure an external API before running an already-open draft', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-1')
    harness.refs.orchestrationTaskEl.value = '完成方案评审'

    harness.store.settings.externalModelOrder = []
    harness.store.settings.externalModelsById = {}
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    expect(harness.errors).toContain('编排依赖外部模型 API，请先配置一个外部模型。')
    expect(harness.openExternalModels).toHaveBeenCalledTimes(1)
    expect(harness.runCommand).not.toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.anything())
  })

  it('opens built-in orchestration templates from a compact picker button', () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()

    expect(harness.refs.openOrchestrationTemplateEl.textContent).toContain('模板')
    expect(harness.refs.orchestrationModalEl.textContent).not.toContain('并行汇总')
    expect(harness.refs.orchestrationTemplateModalEl.hidden).toBe(true)

    harness.refs.openOrchestrationTemplateEl.click()

    expect(harness.refs.orchestrationTemplateModalEl.hidden).toBe(false)
    expect(harness.refs.orchestrationTemplateContentEl.textContent).toContain('编排类型')
    expect(harness.refs.orchestrationTemplateContentEl.textContent).toContain('业务场景')
    expect(harness.refs.orchestrationTemplateContentEl.textContent).toContain('并行汇总')
    expect(harness.refs.orchestrationTemplateContentEl.textContent).toContain('循环审核')
  })

  it('applies a built-in loop template by creating missing roles and generating a review fail edge', async () => {
    const harness = createHarness()
    const nextStore = structuredClone(harness.store)
    const createdRoles: GroupRole[] = [
      { id: 'role-writer', chatId: 'chat-1', name: '执行者', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-reviewer', chatId: 'chat-1', name: '审核员', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
    ]
    nextStore.chatsById['chat-1'].roleIds.push(...createdRoles.map(role => role.id))
    for (const role of createdRoles) nextStore.rolesById[role.id] = role
    harness.sendRuntimeMessage.mockResolvedValue({ ok: true, store: nextStore, roles: createdRoles })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="review-loop"]')?.click()
    await flushAsync()

    expect(harness.sendRuntimeMessage).toHaveBeenCalledWith('GROUP_ROLES_CREATE_BATCH', expect.objectContaining({
      chatId: 'chat-1',
      items: expect.arrayContaining([
        expect.objectContaining({ source: 'temporary', createdBy: 'orchestration-template', name: '执行者', chatSite: 'deepseek' }),
        expect.objectContaining({ source: 'temporary', createdBy: 'orchestration-template', name: '审核员', chatSite: 'deepseek' }),
      ]),
    }))
    expect(harness.refs.orchestrationTemplateModalEl.hidden).toBe(true)
    expect(harness.successes[harness.successes.length - 1]).toContain('循环审核')
    harness.refs.orchestrationTaskEl.value = '打磨一篇发布文案'
    harness.refs.saveOrchestrationEl.click()
    await flushAsync()

    const savePayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_FLOW_SAVE')?.[1] as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages.map(stage => stage.name)).toEqual(['产出初稿', '修改完善', '审核把关'])
    expect(savePayload.flow?.graph?.edges).toContainEqual(expect.objectContaining({ sourceStageId: expect.any(String), targetStageId: expect.any(String), sourcePort: 'fail' }))
    expect(savePayload.flow?.stages.find(stage => stage.kind === 'review')?.review?.instructions).toContain('通过')
  })

  it('fills an empty task from the selected built-in template so it can run immediately', async () => {
    const harness = createHarness()
    const createdRoles: GroupRole[] = [
      { id: 'role-angle-a', chatId: 'chat-1', name: '视角A', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-angle-b', chatId: 'chat-1', name: '视角B', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-angle-c', chatId: 'chat-1', name: '视角C', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-merger', chatId: 'chat-1', name: '汇总者', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
    ]
    harness.sendRuntimeMessage.mockResolvedValue({ ok: true, store: storeWithRoles(harness.store, createdRoles), roles: createdRoles })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="parallel-merge"]')?.click()
    await flushAsync()

    expect(harness.refs.orchestrationTaskEl.value).toBe('请从用户价值、成本风险、增长传播三个视角评估“是否要上线团队共享知识库”，并汇总成优先级明确的建议。')
    harness.refs.runOrchestrationEl.click()
    await flushAsync()
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.objectContaining({ task: harness.refs.orchestrationTaskEl.value }))
  })

  it('keeps a user-written task when applying a built-in template', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    harness.refs.orchestrationTaskEl.value = '评估我们自己的 OpenTeam 模板体验。'

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="parallel-merge"]')?.click()
    await flushAsync()

    expect(harness.refs.orchestrationTaskEl.value).toBe('评估我们自己的 OpenTeam 模板体验。')
  })

  it('removes previously template-created roles before applying another built-in template', async () => {
    const harness = createHarness()
    const loopRoles: GroupRole[] = [
      { id: 'role-loop-writer', chatId: 'chat-1', name: '执行者', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-loop-reviewer', chatId: 'chat-1', name: '审核员', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
    ]
    const parallelRoles: GroupRole[] = [
      { id: 'role-angle-a', chatId: 'chat-1', name: '视角A', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-b', chatId: 'chat-1', name: '视角B', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-c', chatId: 'chat-1', name: '视角C', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-merger', chatId: 'chat-1', name: '汇总者', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
    ]
    harness.sendRuntimeMessage
      .mockResolvedValueOnce({ ok: true, store: storeWithRoles(harness.store, loopRoles), roles: loopRoles })
      .mockResolvedValueOnce({ ok: true, store: storeWithRoles(harness.store, parallelRoles), roles: parallelRoles })
    harness.runCommand.mockImplementation(async (type, payload) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = payload?.roleId
      if (typeof roleId !== 'string') return
      delete harness.store.rolesById[roleId]
      harness.store.chatsById['chat-1'].roleIds = harness.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="review-loop"]')?.click()
    await flushAsync()
    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="parallel-merge"]')?.click()
    await flushAsync()

    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-writer' })
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-reviewer' })
    expect(harness.store.chatsById['chat-1'].roleIds).not.toEqual(expect.arrayContaining(['role-loop-writer', 'role-loop-reviewer']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('removes legacy template roles that were previously marked as auto-generated', async () => {
    const harness = createHarness()
    const legacyTemplateRoles: GroupRole[] = [
      { id: 'role-legacy-writer', chatId: 'chat-1', name: '执行者', createdBy: 'orchestration-auto', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-legacy-reviewer', chatId: 'chat-1', name: '审核员', createdBy: 'orchestration-auto', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
    ]
    harness.store = storeWithRoles(harness.store, legacyTemplateRoles)
    const parallelRoles: GroupRole[] = [
      { id: 'role-angle-a', chatId: 'chat-1', name: '视角A', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-b', chatId: 'chat-1', name: '视角B', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-c', chatId: 'chat-1', name: '视角C', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-merger', chatId: 'chat-1', name: '汇总者', createdBy: 'orchestration-template', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
    ]
    harness.sendRuntimeMessage.mockImplementation(async () => ({ ok: true, store: storeWithRoles(harness.store, parallelRoles), roles: parallelRoles }))
    harness.runCommand.mockImplementation(async (type, payload) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = payload?.roleId
      if (typeof roleId !== 'string') return
      delete harness.store.rolesById[roleId]
      harness.store.chatsById['chat-1'].roleIds = harness.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="parallel-merge"]')?.click()
    await flushAsync()

    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-legacy-writer' })
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-legacy-reviewer' })
    expect(harness.store.chatsById['chat-1'].roleIds).not.toEqual(expect.arrayContaining(['role-legacy-writer', 'role-legacy-reviewer']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('deletes roles created by the previous template even when the store has no template marker', async () => {
    const harness = createHarness()
    const loopRoles: GroupRole[] = [
      { id: 'role-loop-writer', chatId: 'chat-1', name: '执行者', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
      { id: 'role-loop-reviewer', chatId: 'chat-1', name: '审核员', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 },
    ]
    const parallelRoles: GroupRole[] = [
      { id: 'role-angle-a', chatId: 'chat-1', name: '视角A', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-b', chatId: 'chat-1', name: '视角B', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-angle-c', chatId: 'chat-1', name: '视角C', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
      { id: 'role-merger', chatId: 'chat-1', name: '汇总者', chatSite: 'deepseek', status: 'pending', contextCursor: 0, createdAt: 3, updatedAt: 3 },
    ]
    harness.sendRuntimeMessage
      .mockResolvedValueOnce({ ok: true, store: storeWithRoles(harness.store, loopRoles), roles: loopRoles })
      .mockResolvedValueOnce({ ok: true, store: storeWithRoles(harness.store, parallelRoles), roles: parallelRoles })
    harness.runCommand.mockImplementation(async (type, payload) => {
      if (type !== 'GROUP_ROLE_DELETE') return
      const roleId = payload?.roleId
      if (typeof roleId !== 'string') return
      delete harness.store.rolesById[roleId]
      harness.store.chatsById['chat-1'].roleIds = harness.store.chatsById['chat-1'].roleIds.filter(id => id !== roleId)
    })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="review-loop"]')?.click()
    await flushAsync()
    harness.refs.openOrchestrationTemplateEl.click()
    harness.refs.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('[data-template-id="parallel-merge"]')?.click()
    await flushAsync()

    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-writer' })
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_DELETE', { roleId: 'role-loop-reviewer' })
    expect(harness.store.chatsById['chat-1'].roleIds).not.toEqual(expect.arrayContaining(['role-loop-writer', 'role-loop-reviewer']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-angle-a', 'role-angle-b', 'role-angle-c', 'role-merger']))
    expect(harness.store.chatsById['chat-1'].roleIds).toEqual(expect.arrayContaining(['role-1', 'role-2']))
  })

  it('opens a blank draft by default when the chat has no saved orchestration flow', () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()

    expect(harness.refs.orchestrationHintEl.hidden).toBe(false)
    expect(harness.refs.orchestrationStageSettingsEl.textContent).toBe('')
    expect(harness.refs.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-settings')?.hidden).toBe(true)
  })

  it('shows stage settings only after the user selects a canvas node', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()
    dropRole(harness, 'role-1')

    expect(harness.refs.orchestrationStageSettingsEl.textContent).toBe('')
    expect(harness.refs.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-settings')?.hidden).toBe(true)

    const stageId = MockGraph.latest().nodes[0].id
    expect(stageId).toBeTruthy()
    MockGraph.latest().selectNode(stageId as string)

    expect(harness.refs.orchestrationStageSettingsEl.textContent).toContain('节点名称')
    expect(harness.refs.orchestrationStageSettingsEl.textContent).toContain('任务描述')
    expect(harness.refs.orchestrationStageSettingsEl.textContent).not.toContain('阶段')
    expect(harness.refs.orchestrationStageSettingsEl.textContent).toContain('执行人员')
    expect(harness.refs.orchestrationStageSettingsEl.querySelector('.stage-role-chip button')).toBeNull()
    expect(harness.refs.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-settings')?.hidden).toBe(false)
  })

  it('does not rebuild the graph when selecting a node for editing', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()
    dropRole(harness, 'role-1')
    dropRole(harness, 'role-2')
    const graph = MockGraph.latest()
    const clearCalls = graph.clearCalls
    const addNodeCalls = graph.addNodeCalls
    const stageId = graph.nodes[0].id
    expect(stageId).toBeTruthy()

    graph.selectNode(stageId as string)

    expect(graph.clearCalls).toBe(clearCalls)
    expect(graph.addNodeCalls).toBe(addNodeCalls)
    expect(harness.refs.orchestrationStageSettingsEl.textContent).toContain('任务描述')
  })

  it('closes node settings without rebuilding the canvas', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()
    dropRole(harness, 'role-1')
    const graph = MockGraph.latest()
    const stageId = graph.nodes[0].id
    expect(stageId).toBeTruthy()
    graph.selectNode(stageId as string)
    const clearCalls = graph.clearCalls
    const addNodeCalls = graph.addNodeCalls

    const closeButton = harness.refs.orchestrationStageSettingsEl.querySelector<HTMLButtonElement>('[aria-label="关闭节点设置"]')
    expect(closeButton).not.toBeNull()
    closeButton?.click()

    expect(harness.refs.orchestrationStageSettingsEl.textContent).toBe('')
    expect(harness.refs.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-settings')?.hidden).toBe(true)
    expect(graph.clearCalls).toBe(clearCalls)
    expect(graph.addNodeCalls).toBe(addNodeCalls)
  })

  it('saves a selected node task description with the orchestration flow', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()
    dropRole(harness, 'role-1')
    const stageId = MockGraph.latest().nodes[0].id as string
    MockGraph.latest().selectNode(stageId)
    const description = harness.refs.orchestrationStageSettingsEl.querySelector('textarea') as HTMLTextAreaElement
    description.value = '先澄清用户目标，并输出优先级列表。'
    description.dispatchEvent(new Event('input', { bubbles: true }))
    harness.refs.orchestrationTaskEl.value = '保存这次任务'

    harness.refs.saveOrchestrationEl.click()
    await flushAsync()

    const savePayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_FLOW_SAVE')?.[1] as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages[0].description).toBe('先澄清用户目标，并输出优先级列表。')
    expect(savePayload.flow?.graph?.stageNodes[0].description).toBe('先澄清用户目标，并输出优先级列表。')
  })

  it('arranges the canvas from the top-right toolbar and saves node positions', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()
    dropRole(harness, 'role-1')
    dropRole(harness, 'role-2')
    harness.refs.arrangeOrchestrationEl.click()
    harness.refs.orchestrationTaskEl.value = '整理后保存'
    harness.refs.saveOrchestrationEl.click()
    await flushAsync()

    const savePayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_FLOW_SAVE')?.[1] as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.graph?.stageNodes.map(stage => stage.position)).toEqual([
      { x: 56, y: 96 },
      { x: 236, y: 96 },
    ])
  })

  it('restores a saved orchestration flow for the current chat after refresh', async () => {
    const harness = createHarness()
    const savedFlow: OrchestrationFlow = {
      id: 'flow-saved',
      chatId: 'chat-1',
      name: '已保存流程',
      description: '保存过的任务',
      stages: [
        { id: 'stage-saved-1', kind: 'roles', name: '旧阶段 1', roleIds: ['role-1'], description: '保存过的节点说明' },
        { id: 'stage-saved-2', kind: 'roles', name: '旧阶段 2', roleIds: ['role-2'] },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-saved-1', kind: 'roles', name: '旧阶段 1', roleIds: ['role-1'], description: '保存过的节点说明' },
          { id: 'stage-saved-2', kind: 'roles', name: '旧阶段 2', roleIds: ['role-2'] },
        ],
        edges: [{ sourceStageId: 'stage-saved-1', targetStageId: 'stage-saved-2' }],
      },
      maxNodeExecutions: 8,
      maxRounds: 3,
      createdAt: 1,
      updatedAt: 1,
    }
    harness.store.orchestrationFlowsById[savedFlow.id] = savedFlow
    harness.store.orchestrationFlowOrderByChatId['chat-1'] = [savedFlow.id]
    const view = createView(harness)
    view.registerOrchestrationEvents()

    harness.refs.openOrchestrationEl.click()
    await flushAsync()

    expect(harness.refs.orchestrationHintEl.hidden).toBe(true)
    expect(harness.refs.orchestrationStageSettingsEl.querySelector('input')).toBeNull()
    MockGraph.latest().selectNode('stage-saved-1')
    expect((harness.refs.orchestrationStageSettingsEl.querySelector('input') as HTMLInputElement).value).toBe('旧阶段 1')
    expect((harness.refs.orchestrationStageSettingsEl.querySelector('textarea') as HTMLTextAreaElement).value).toBe('保存过的节点说明')
    expect(harness.refs.orchestrationMaxRoundsEl.value).toBe('8')
    expect(harness.refs.orchestrationTaskEl.value).toBe('保存过的任务')
    harness.refs.orchestrationTaskEl.value = '继续执行'
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    const runPayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_RUN')?.[1] as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.id).toBe('flow-saved')
    expect(runPayload.flow?.graph?.edges).toEqual([{ sourceStageId: 'stage-saved-1', targetStageId: 'stage-saved-2' }])
  })

  it('validates max node executions and saves a stage draft through GROUP_ORCHESTRATION_FLOW_SAVE', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-1')
    harness.refs.orchestrationTaskEl.value = '保存这次任务'
    harness.refs.orchestrationMaxRoundsEl.value = '201'

    harness.refs.saveOrchestrationEl.click()
    await Promise.resolve()

    expect(harness.errors).toContain('最大节点执行数需在 1-200 之间')
    harness.refs.orchestrationMaxRoundsEl.value = '12'
    harness.refs.saveOrchestrationEl.click()
    await Promise.resolve()

    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_FLOW_SAVE', expect.objectContaining({ chatId: 'chat-1', flow: expect.objectContaining({ description: '保存这次任务', maxNodeExecutions: 12, maxRounds: 12 }) }))
  })

  it('validates run task and review settings before GROUP_ORCHESTRATION_RUN', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-2')
    await flushAsync()
    MockGraph.latest().selectNode(MockGraph.latest().nodes[0].id as string)
    const typeSelect = harness.refs.orchestrationStageSettingsEl.querySelector('select[data-stage-kind]') as HTMLSelectElement
    typeSelect.value = 'review'
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(harness.refs.orchestrationStageSettingsEl.querySelector('.stage-role-chip button')).toBeNull()
    expect(harness.refs.orchestrationReviewSettingsEl.textContent).not.toContain('审核人员')
    expect(harness.refs.orchestrationReviewSettingsEl.textContent).toContain('最大审核次数')
    expect(harness.refs.orchestrationReviewSettingsEl.textContent).toContain('达到上限后')
    const attempts = harness.refs.orchestrationReviewSettingsEl.querySelector('input[type="number"]') as HTMLInputElement
    const maxAction = harness.refs.orchestrationReviewSettingsEl.querySelector('select') as HTMLSelectElement
    expect(attempts.value).toBe('3')
    expect(maxAction.value).toBe('stop')

    harness.refs.runOrchestrationEl.click()
    await Promise.resolve()
    expect(harness.errors).toContain('请输入编排任务')

    harness.refs.orchestrationTaskEl.value = '完成方案评审'
    harness.refs.runOrchestrationEl.click()
    await Promise.resolve()
    expect(harness.errors).toContain('审核节点需要审核人员和审核标准')

    const criteria = harness.refs.orchestrationReviewSettingsEl.querySelector('textarea') as HTMLTextAreaElement
    criteria.value = '必须包含结论'
    criteria.dispatchEvent(new Event('input', { bubbles: true }))
    attempts.value = '2'
    attempts.dispatchEvent(new Event('input', { bubbles: true }))
    maxAction.value = 'continue'
    maxAction.dispatchEvent(new Event('change', { bubbles: true }))
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ORCHESTRATION_RUN', expect.objectContaining({ chatId: 'chat-1', task: '完成方案评审', flow: expect.any(Object) }))
    const runPayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_RUN')?.[1] as { flow?: OrchestrationFlow }
    expect(runPayload.flow?.stages[0].review).toMatchObject({ maxAttempts: 2, onMaxAttempts: 'continue' })
  })

  it('recovers stage roles before running an orchestration', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-1')
    dropRole(harness, 'role-2')
    harness.refs.orchestrationTaskEl.value = '完成方案评审'

    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    expect(harness.reconnectRolesForSend).toHaveBeenCalledWith(harness.store.chatsById['chat-1'], [harness.store.rolesById['role-1'], harness.store.rolesById['role-2']])
    expect(harness.runCommand.mock.invocationCallOrder[0]).toBeGreaterThan(harness.reconnectRolesForSend.mock.invocationCallOrder[0])
  })

  it('auto-generates a draft from a chat-style dialog with streaming assistant text', async () => {
    const harness = createHarness()
    const generatedStore = structuredClone(harness.store)
    generatedStore.chatsById['chat-1'].roleIds.push('role-new')
    generatedStore.rolesById['role-new'] = { id: 'role-new', chatId: 'chat-1', name: '写手', createdBy: 'orchestration-auto', chatSite: 'chatgpt', systemPrompt: '旧写作人设', status: 'pending', contextCursor: 0, createdAt: 2, updatedAt: 2 }
    const generatedFlow: OrchestrationFlow = {
      id: 'flow-auto',
      chatId: 'chat-1',
      name: '自动流程',
      description: '自动任务',
      stages: [
        { id: 'stage-plan', kind: 'roles', name: '规划', roleIds: ['role-1'], description: '拆解任务' },
        { id: 'stage-write', kind: 'roles', name: '写作', roleIds: ['role-new'], description: '输出初稿' },
        { id: 'stage-review', kind: 'review', name: '审核', roleIds: ['role-2'], description: '判断质量', review: { reviewerRoleIds: ['role-2'], instructions: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' } },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-plan', kind: 'roles', name: '规划', roleIds: ['role-1'], description: '拆解任务' },
          { id: 'stage-write', kind: 'roles', name: '写作', roleIds: ['role-new'], description: '输出初稿' },
          { id: 'stage-review', kind: 'review', name: '审核', roleIds: ['role-2'], description: '判断质量', review: { reviewerRoleIds: ['role-2'], instructions: '必须可交付', maxAttempts: 3, onMaxAttempts: 'stop' } },
        ],
        edges: [
          { sourceStageId: 'stage-plan', targetStageId: 'stage-write' },
          { sourceStageId: 'stage-write', targetStageId: 'stage-review' },
          { sourceStageId: 'stage-review', targetStageId: 'stage-write', sourcePort: 'fail' },
        ],
      },
      maxNodeExecutions: 30,
      maxRounds: 30,
      autoPlanHistory: [
        { id: 'auto-history-1', role: 'user', content: '写一篇文章', createdAt: 2 },
        { id: 'auto-history-2', role: 'assistant', content: '已生成自动流程', createdAt: 2 },
      ],
      createdAt: 2,
      updatedAt: 2,
    }
    generatedStore.orchestrationFlowsById[generatedFlow.id] = generatedFlow
    generatedStore.orchestrationFlowOrderByChatId['chat-1'] = [generatedFlow.id]
    harness.sendRuntimeMessage.mockResolvedValue({ ok: true, store: generatedStore, flow: generatedFlow, createdRoleIds: ['role-new'], reusedRoleIds: ['role-1', 'role-2'] })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    harness.refs.orchestrationTaskEl.value = '写一篇文章'

    harness.refs.autoOrchestrationEl.click()
    expect(harness.sendRuntimeMessage).not.toHaveBeenCalled()
    const chat = harness.refs.orchestrationAutoContentEl.querySelector<HTMLElement>('.orchestration-auto-chat')
    expect(chat).not.toBeNull()
    expect(chat?.querySelector('.orchestration-auto-task-preview')).toBeNull()
    expect(chat?.querySelector('.orchestration-auto-history')).toBeNull()
    const input = chat?.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')
    expect(input).not.toBeNull()
    input!.value = '先规划，再写作，最后审核'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    chat?.querySelector<HTMLButtonElement>('.orchestration-auto-submit')?.click()
    const payload = harness.sendRuntimeMessage.mock.calls[0][1] as { streamId?: string }
    expect(payload.streamId).toMatch(/^auto-stream-/)
    ;(view as ReturnType<typeof createView> & { handleRuntimeMessage(message: unknown): boolean }).handleRuntimeMessage({
      type: 'GROUP_ORCHESTRATION_AUTO_STREAM_CHUNK',
      streamId: payload.streamId,
      chunk: '正在生成自动流程',
      content: '正在生成自动流程',
    })
    expect(harness.refs.orchestrationAutoContentEl.textContent).toContain('先规划，再写作，最后审核')
    expect(harness.refs.orchestrationAutoContentEl.textContent).toContain('正在生成自动流程')
    await flushAsync()

    expect(harness.sendRuntimeMessage).toHaveBeenCalledWith('GROUP_ORCHESTRATION_AUTO_GENERATE', expect.objectContaining({ chatId: 'chat-1', task: '写一篇文章', instruction: '先规划，再写作，最后审核', flowId: undefined, streamId: expect.any(String) }))
    expect(harness.refs.orchestrationPeopleListEl.textContent).toContain('写手')
    expect(harness.refs.orchestrationAutoModalEl.hidden).toBe(false)
    expect(harness.refs.orchestrationAutoContentEl.querySelector('.orchestration-auto-chat')).not.toBeNull()
    expect(harness.refs.orchestrationAutoContentEl.textContent).toContain('已生成自动流程')
    expect((MockGraph.latest().nodes.find(node => node.id === 'stage-write') as { label?: string } | undefined)?.label).toContain('ChatGPT')
    expect(harness.successes[harness.successes.length - 1]).toContain('新增 1 个人员')
    MockGraph.latest().selectNode('stage-plan')
    expect(harness.refs.orchestrationStageSettingsEl.querySelector('.orchestration-auto-role-site-row')).toBeNull()
    MockGraph.latest().selectNode('stage-write')
    const siteSelect = harness.refs.orchestrationStageSettingsEl.querySelector<HTMLSelectElement>('.orchestration-auto-role-site-row select')
    expect(siteSelect?.value).toBe('chatgpt')
    siteSelect!.value = 'chatgpt'
    siteSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushAsync()
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_UPDATE', { roleId: 'role-new', patch: { modelSource: 'site', chatSite: 'chatgpt' } })
    const promptInput = harness.refs.orchestrationStageSettingsEl.querySelector<HTMLTextAreaElement>('.orchestration-auto-role-prompt')
    expect(promptInput?.value).toBe('旧写作人设')
    promptInput!.value = '新的写作人设'
    promptInput!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushAsync()
    expect(harness.runCommand).toHaveBeenCalledWith('GROUP_ROLE_UPDATE', { roleId: 'role-new', patch: { systemPrompt: '新的写作人设' } })
    harness.refs.saveOrchestrationEl.click()
    await flushAsync()
    const savePayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_FLOW_SAVE')?.[1] as { flow?: OrchestrationFlow }
    expect(savePayload.flow?.stages.map(stage => stage.id)).toEqual(['stage-plan', 'stage-write', 'stage-review'])
    expect(savePayload.flow?.graph?.edges).toContainEqual({ sourceStageId: 'stage-review', targetStageId: 'stage-write', sourcePort: 'fail', vertices: expect.any(Array) })
    expect(savePayload.flow?.autoPlanHistory?.map(entry => entry.role)).toEqual(['user', 'assistant'])
    harness.refs.closeOrchestrationEl.click()
    harness.refs.openOrchestrationEl.click()
    harness.refs.autoOrchestrationEl.click()
    expect(harness.refs.orchestrationAutoContentEl.textContent).toContain('写一篇文章')
    expect(harness.refs.orchestrationAutoContentEl.textContent).toContain('已生成自动流程')
  })

  it('opens automatic orchestration in a separate dialog instead of embedding it in the main editor', () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.autoOrchestrationEl.click()

    expect(harness.refs.orchestrationAutoModalEl.hidden).toBe(false)
    expect(harness.refs.orchestrationAutoContentEl.querySelector('.orchestration-auto-chat')).not.toBeNull()
    expect(harness.refs.orchestrationAutoContentEl.querySelector('.orchestration-auto-panel-header')).toBeNull()
    expect(harness.refs.orchestrationAutoContentEl.querySelector('[aria-label="关闭自动编排面板"]')).toBeNull()
    expect(harness.refs.orchestrationModalEl.querySelector('.orchestration-auto-chat')).toBeNull()
  })

  it('sends the current draft and auto history when modifying an existing orchestration from the panel', async () => {
    const harness = createHarness()
    const savedFlow: OrchestrationFlow = {
      id: 'flow-saved',
      chatId: 'chat-1',
      name: '已有流程',
      description: '写文章',
      stages: [{ id: 'stage-saved-1', kind: 'roles', name: '写作', roleIds: ['role-1'], description: '写初稿' }],
      graph: { stageNodes: [{ id: 'stage-saved-1', kind: 'roles', name: '写作', roleIds: ['role-1'], description: '写初稿' }], edges: [] },
      autoPlanHistory: [
        { id: 'auto-history-1', role: 'user', content: '先写作', createdAt: 1 },
        { id: 'auto-history-2', role: 'assistant', content: '已生成写作节点', createdAt: 2 },
      ],
      maxNodeExecutions: 20,
      maxRounds: 20,
      createdAt: 1,
      updatedAt: 2,
    }
    harness.store.orchestrationFlowsById[savedFlow.id] = savedFlow
    harness.store.orchestrationFlowOrderByChatId['chat-1'] = [savedFlow.id]
    harness.sendRuntimeMessage.mockResolvedValue({ ok: true, store: harness.store, flow: savedFlow, createdRoleIds: [], reusedRoleIds: ['role-1'] })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()

    harness.refs.autoOrchestrationEl.click()
    const chat = harness.refs.orchestrationAutoContentEl.querySelector<HTMLElement>('.orchestration-auto-chat')
    expect(chat?.textContent).toContain('已生成写作节点')
    const input = chat?.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')
    input!.value = '增加审核失败回写作'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    chat?.querySelector<HTMLButtonElement>('.orchestration-auto-submit')?.click()
    await flushAsync()

    const payload = harness.sendRuntimeMessage.mock.calls[0][1] as { instruction?: string; flow?: OrchestrationFlow; history?: unknown[] }
    expect(payload.instruction).toBe('增加审核失败回写作')
    expect(payload.flow?.id).toBe('flow-saved')
    expect(payload.flow?.graph?.stageNodes[0].description).toBe('写初稿')
    expect(payload.history).toEqual(savedFlow.autoPlanHistory)
  })

  it('ignores repeated run clicks while the first run is still starting', async () => {
    const harness = createHarness()
    let finishRun: (() => void) | undefined
    harness.runCommand.mockImplementation(async type => {
      if (type !== 'GROUP_ORCHESTRATION_RUN') return
      await new Promise<void>(resolve => {
        finishRun = resolve
      })
    })
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-1')
    harness.refs.orchestrationTaskEl.value = '完成方案评审'

    harness.refs.runOrchestrationEl.click()
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    expect(harness.runCommand.mock.calls.filter(call => call[0] === 'GROUP_ORCHESTRATION_RUN')).toHaveLength(1)
    expect(harness.refs.runOrchestrationEl.disabled).toBe(true)
    finishRun?.()
    await flushAsync()
  })

  it('orders stages by graph edges when saving the draft', () => {
    const unorderedStages = [
      { id: 'stage-2', kind: 'roles' as const, name: '工程判断', roleIds: ['role-2'] },
      { id: 'stage-1', kind: 'roles' as const, name: '产品需求', roleIds: ['role-1'] },
      { id: 'review-1', kind: 'review' as const, name: '审核', roleIds: ['role-3'], review: { reviewerRoleIds: ['role-3'] } },
    ]

    const ordered = orderStagesByGraph(unorderedStages, [
      { sourceStageId: 'stage-1', targetStageId: 'stage-2' },
      { sourceStageId: 'stage-2', targetStageId: 'review-1' },
    ])

    expect(ordered.map(stage => stage.id)).toEqual(['stage-1', 'stage-2', 'review-1'])
  })

  it('drops roles as independent nodes and leaves connection decisions to the user', async () => {
    const harness = createHarness()
    const view = createView(harness)
    view.registerOrchestrationEvents()
    harness.refs.openOrchestrationEl.click()
    dropRole(harness, 'role-1')
    dropRole(harness, 'role-2')

    harness.refs.orchestrationTaskEl.value = '完成方案评审'
    harness.refs.runOrchestrationEl.click()
    await flushAsync()

    const runPayload = harness.runCommand.mock.calls.find(call => call[0] === 'GROUP_ORCHESTRATION_RUN')?.[1] as { flow?: { stages: Array<{ id: string; roleIds: string[] }>; graph?: { edges: Array<{ sourceStageId: string; targetStageId: string }> } } }
    expect(runPayload.flow?.stages.map(stage => stage.roleIds)).toEqual([['role-1'], ['role-2']])
    expect(runPayload.flow?.graph?.edges).toEqual([])
  })
})

function dropRole(harness: Harness, roleId: string): void {
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => roleId, types: ['application/x-openteam-role-id'] } })
  harness.refs.orchestrationCanvasEl.dispatchEvent(drop)
}

function storeWithRoles(baseStore: OpenTeamStore, roles: GroupRole[]): OpenTeamStore {
  const store = structuredClone(baseStore)
  store.chatsById['chat-1'].roleIds.push(...roles.map(role => role.id))
  for (const role of roles) store.rolesById[role.id] = role
  return store
}

function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
