// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import { getAllRoleTemplates } from '../group/roleTemplates'
import type { GroupChat, OpenTeamStore, RoleTemplate } from '../group/types'
import { createTeamPageState } from './appState'
import { createPeopleLibraryView } from './peopleLibraryView'

function makeTemplate(index: number): RoleTemplate {
  return {
    id: `template-${index}`,
    type: 'custom',
    name: `人员${index}`,
    description: `描述${index}`,
    defaultChatSite: 'gemini',
    systemPrompt: `提示词${index}`,
    createdAt: index,
    updatedAt: index,
  }
}

function makeChat(id: string): GroupChat {
  return {
    id,
    name: '群聊',
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

function setupPeopleLibraryView(options: { store: OpenTeamStore; templates: RoleTemplate[]; currentChat?: GroupChat; language?: OpenTeamStore['settings']['language'] }) {
  options.store.settings.language = options.language ?? 'zh-CN'
  const state = createTeamPageState()
  const addLibraryPeopleListEl = document.createElement('div')
  const addLibraryPeopleFormEl = document.createElement('form')
  const peopleLibrarySearchEl = document.createElement('input')
  const peopleLibraryCategoryFilterEl = document.createElement('div')
  const peopleLibraryBuiltinTabEl = document.createElement('button')
  const peopleLibraryCustomTabEl = document.createElement('button')
  const addPersonSearchEl = document.createElement('input')
  const addPersonCategoryFilterEl = document.createElement('div')
  const addPersonBuiltinTabEl = document.createElement('button')
  const addPersonCustomTabEl = document.createElement('button')
  const peopleLibraryListEl = document.createElement('div')
  const peopleLibraryPaginationEl = document.createElement('div')
  const templateListEl = document.createElement('div')
  const templateSiteChatGptEl = document.createElement('input')
  const templateSiteGrokEl = document.createElement('input')
  const templateSiteExternalEl = document.createElement('input')
  const templateExternalModelFieldEl = Object.assign(document.createElement('div'), { hidden: true })
  const templateExternalModelSelectEl = document.createElement('select')
  const templateChatGptGptsFieldEl = Object.assign(document.createElement('div'), { hidden: true })
  const templateChatGptGptsUrlEl = document.createElement('input')
  const templateGrokProjectFieldEl = Object.assign(document.createElement('div'), { hidden: true })
  const templateGrokProjectUrlEl = document.createElement('input')
  const templateNameEl = document.createElement('input')
  const templateDescriptionEl = document.createElement('textarea')
  const templatePromptEl = document.createElement('textarea')
  const templateAiDescriptionEl = document.createElement('textarea')
  const generateTemplatePersonaEl = document.createElement('button')
  const templatePersonaGenerationStatusEl = document.createElement('div')
  const peopleLibraryFormEl = document.createElement('form')
  const builtinTemplateDetailModalEl = Object.assign(document.createElement('div'), { hidden: true })
  const builtinTemplateDetailTitleEl = document.createElement('div')
  const builtinTemplateDetailMetaEl = document.createElement('div')
  const builtinTemplateDetailPromptEl = document.createElement('pre')
  const closeBuiltinTemplateDetailEl = document.createElement('button')
  const runCommand = vi.fn(async () => undefined)
  const generatePersona = vi.fn(async () => ({
    name: 'AI 人员',
    description: 'AI 生成的描述',
    systemPrompt: 'AI 生成的人设',
  }))
  const showError = vi.fn()
  const view = createPeopleLibraryView({
    state,
    getStore: () => options.store,
    settingsButtonEl: document.createElement('button'),
    settingsMenuEl: document.createElement('div'),
    openPeopleLibraryEl: document.createElement('button'),
    closePeopleLibraryEl: document.createElement('button'),
    peopleLibraryModalEl: document.createElement('div'),
    personTemplateModalEl: Object.assign(document.createElement('div'), { hidden: true }),
    addPersonModalEl: document.createElement('div'),
    temporaryPersonModalEl: document.createElement('div'),
    peopleLibrarySummaryEl: document.createElement('div'),
    peopleLibraryListEl,
    peopleLibraryPaginationEl,
    peopleLibrarySearchEl,
    peopleLibraryCategoryFilterEl,
    peopleLibraryBuiltinTabEl,
    peopleLibraryCustomTabEl,
    addLibraryPeopleListEl,
    addPersonSearchEl,
    addPersonCategoryFilterEl,
    addPersonBuiltinTabEl,
    addPersonCustomTabEl,
    builtinTemplateDetailModalEl,
    builtinTemplateDetailTitleEl,
    builtinTemplateDetailMetaEl,
    builtinTemplateDetailPromptEl,
    closeBuiltinTemplateDetailEl,
    roleTemplateSelectEl: document.createElement('select'),
    templateListEl,
    templateNameEl,
    templateDescriptionEl,
    templatePromptEl,
    templateAiDescriptionEl,
    generateTemplatePersonaEl,
    templatePersonaGenerationStatusEl,
    templateFormTitleEl: document.createElement('div'),
    templateSiteGeminiEl: document.createElement('input'),
    templateSiteChatGptEl,
    templateSiteClaudeEl: document.createElement('input'),
    templateSiteDeepSeekEl: document.createElement('input'),
    templateSiteGrokEl,
    templateSiteQwenEl: document.createElement('input'),
    templateSiteExternalEl,
    templateExternalModelFieldEl,
    templateExternalModelSelectEl,
    templateChatGptGptsFieldEl,
    templateChatGptGptsUrlEl,
    templateGrokProjectFieldEl,
    templateGrokProjectUrlEl,
    temporaryPersonNameEl: document.createElement('input'),
    temporaryPersonDescriptionEl: document.createElement('textarea'),
    temporaryPersonPromptEl: document.createElement('textarea'),
    newTemplateEl: document.createElement('button'),
    closePersonTemplateEl: document.createElement('button'),
    closeAddPersonEl: document.createElement('button'),
    openTemporaryPersonEl: document.createElement('button'),
    closeTemporaryPersonEl: document.createElement('button'),
    addRoleFormEl: document.createElement('form'),
    addLibraryPeopleFormEl,
    addTemporaryPersonFormEl: document.createElement('form'),
    peopleLibraryFormEl,
    getCurrentChat: () => options.currentChat,
    getTemplates: () => options.templates,
    emptyCard: (title: string, body: string) => {
      const element = document.createElement('div')
      element.textContent = `${title}${body}`
      return element
    },
    generatePersona,
    runCommand,
    showError,
    log: { info: vi.fn() },
  })
  return {
    state,
    view,
    addLibraryPeopleFormEl,
    addLibraryPeopleListEl,
    peopleLibrarySearchEl,
    peopleLibraryCategoryFilterEl,
    peopleLibraryBuiltinTabEl,
    peopleLibraryCustomTabEl,
    addPersonSearchEl,
    addPersonCategoryFilterEl,
    addPersonBuiltinTabEl,
    addPersonCustomTabEl,
    builtinTemplateDetailModalEl,
    builtinTemplateDetailTitleEl,
    builtinTemplateDetailMetaEl,
    builtinTemplateDetailPromptEl,
    closeBuiltinTemplateDetailEl,
    peopleLibraryListEl,
    peopleLibraryPaginationEl,
    runCommand,
    templateListEl,
    templateNameEl,
    templateDescriptionEl,
    templatePromptEl,
    templateAiDescriptionEl,
    generateTemplatePersonaEl,
    templatePersonaGenerationStatusEl,
    generatePersona,
    templateSiteChatGptEl,
    templateSiteGrokEl,
    templateChatGptGptsFieldEl,
    templateChatGptGptsUrlEl,
    templateGrokProjectFieldEl,
    templateGrokProjectUrlEl,
    peopleLibraryFormEl,
    showError,
  }
}

describe('team page people library view boundary', () => {
  it('keeps people library rendering, add-person dialogs, and template edits outside the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')

    expect(viewSource).toContain('function renderTemplates(): void')
    expect(viewSource).toContain('function renderTemplateEditor(): void')
    expect(viewSource).toContain('function openAddPersonDialog(): void')
    expect(viewSource).toContain('function renderAddPersonDialog(): void')
    expect(viewSource).toContain('function addPersonItems(): AddPersonItem[]')
    expect(viewSource).toContain('function selectedAddPersonItems(): Record<string, unknown>[]')
    expect(viewSource).toContain('function registerPeopleLibraryEvents(): void')
    expect(entrySource).not.toContain('function renderTemplates(): void')
    expect(entrySource).not.toContain('function renderTemplateEditor(): void')
    expect(entrySource).not.toContain('function openAddPersonDialog(): void')
    expect(entrySource).not.toContain('function renderAddPersonDialog(): void')
    expect(entrySource).not.toContain('function addPersonItems(): AddPersonItem[]')
    expect(entrySource).not.toContain('function selectedAddPersonItems(): Record<string, unknown>[]')
  })

  it('renders five people library entries per page', () => {
    const templates = Array.from({ length: 6 }, (_, index) => makeTemplate(index + 1))
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      roleTemplateOrder: templates.map(template => template.id),
      roleTemplatesById: Object.fromEntries(templates.map(template => [template.id, template])),
    }
    const { view, peopleLibraryListEl, peopleLibraryPaginationEl, templateListEl } = setupPeopleLibraryView({ store, templates })

    view.renderTemplates()

    expect(peopleLibraryListEl.querySelectorAll('.template-card')).toHaveLength(5)
    expect(templateListEl.querySelectorAll('.template-card')).toHaveLength(5)
    expect(peopleLibraryPaginationEl.textContent).toContain('1 / 2')
  })

  it('submits one library person once for every selected chat site', async () => {
    const template = makeTemplate(1)
    const chat = makeChat('chat-1')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      roleTemplateOrder: [template.id],
      roleTemplatesById: { [template.id]: template },
    }
    const { view, addLibraryPeopleFormEl, addLibraryPeopleListEl, runCommand } = setupPeopleLibraryView({ store, templates: [template], currentChat: chat })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    const claudeSite = addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:claude"]')!
    claudeSite.checked = true
    claudeSite.dispatchEvent(new Event('change', { bubbles: true }))
    addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!.checked = true
    addLibraryPeopleFormEl.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(runCommand).toHaveBeenCalledWith('GROUP_ROLES_CREATE_BATCH', {
      chatId: chat.id,
      items: [
        { source: 'library', roleTemplateId: template.id, modelSource: 'site', chatSite: 'gemini' },
        { source: 'library', roleTemplateId: template.id, modelSource: 'site', chatSite: 'claude' },
      ],
    })
  })

  it('keeps selected people checked while changing their chat sites', () => {
    const template = makeTemplate(1)
    const chat = makeChat('chat-1')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      roleTemplateOrder: [template.id],
      roleTemplatesById: { [template.id]: template },
    }
    const { view, addLibraryPeopleListEl } = setupPeopleLibraryView({ store, templates: [template], currentChat: chat })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    const personCheckbox = addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!
    personCheckbox.checked = true
    personCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    const claudeSite = addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="site:claude"]')!
    claudeSite.checked = true
    claudeSite.dispatchEvent(new Event('change', { bubbles: true }))

    expect(addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:template-1"]')!.checked).toBe(true)
  })

  it('submits a ChatGPT GPTs prefix when creating a library person', async () => {
    const store = createDefaultStore()
    const {
      view,
      runCommand,
      templateNameEl,
      templatePromptEl,
      templateSiteChatGptEl,
      templateChatGptGptsFieldEl,
      templateChatGptGptsUrlEl,
      peopleLibraryFormEl,
    } = setupPeopleLibraryView({ store, templates: [] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateNameEl.value = '飞飞教练'
    templatePromptEl.value = '以教练方式回应'
    templateSiteChatGptEl.checked = true
    templateSiteChatGptEl.dispatchEvent(new Event('change', { bubbles: true }))
    templateChatGptGptsUrlEl.value = 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/69f7fabe-9878-83a8-a867-88ebb36967d4'
    peopleLibraryFormEl.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(templateChatGptGptsFieldEl.hidden).toBe(false)
    expect(templateChatGptGptsFieldEl.style.display).toBe('')
    expect(runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '飞飞教练',
      description: '',
      systemPrompt: '以教练方式回应',
      defaultModelSource: 'site',
      defaultChatSite: 'chatgpt',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/69f7fabe-9878-83a8-a867-88ebb36967d4',
      grokProjectUrl: undefined,
    })
  })

  it('hides the ChatGPT GPTs prefix field when another site is selected', () => {
    const store = createDefaultStore()
    const {
      view,
      templateSiteChatGptEl,
      templateChatGptGptsFieldEl,
      templateChatGptGptsUrlEl,
    } = setupPeopleLibraryView({ store, templates: [] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateSiteChatGptEl.checked = false
    templateChatGptGptsUrlEl.value = 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian'
    templateSiteChatGptEl.dispatchEvent(new Event('change', { bubbles: true }))

    expect(templateChatGptGptsFieldEl.hidden).toBe(true)
    expect(templateChatGptGptsFieldEl.style.display).toBe('none')
    expect(templateChatGptGptsUrlEl.value).toBe('')
  })

  it('submits a Grok project URL when creating a library person', async () => {
    const store = createDefaultStore()
    const {
      view,
      runCommand,
      templateNameEl,
      templatePromptEl,
      templateSiteGrokEl,
      templateGrokProjectFieldEl,
      templateGrokProjectUrlEl,
      peopleLibraryFormEl,
    } = setupPeopleLibraryView({ store, templates: [] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateNameEl.value = '项目顾问'
    templatePromptEl.value = '在项目上下文中回应'
    templateSiteGrokEl.checked = true
    templateSiteGrokEl.dispatchEvent(new Event('change', { bubbles: true }))
    templateGrokProjectUrlEl.value = 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81?source=share'
    peopleLibraryFormEl.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(templateGrokProjectFieldEl.hidden).toBe(false)
    expect(templateGrokProjectFieldEl.style.display).toBe('')
    expect(runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '项目顾问',
      description: '',
      systemPrompt: '在项目上下文中回应',
      defaultModelSource: 'site',
      defaultChatSite: 'grok',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: undefined,
      grokProjectUrl: 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81?source=share',
    })
  })

  it('hides the Grok project field when another site is selected', () => {
    const store = createDefaultStore()
    const {
      view,
      templateSiteGrokEl,
      templateGrokProjectFieldEl,
      templateGrokProjectUrlEl,
    } = setupPeopleLibraryView({ store, templates: [] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateSiteGrokEl.checked = false
    templateGrokProjectUrlEl.value = 'https://grok.com/project/a9e415eb-149b-42b8-811a-63b12477ed81'
    templateSiteGrokEl.dispatchEvent(new Event('change', { bubbles: true }))

    expect(templateGrokProjectFieldEl.hidden).toBe(true)
    expect(templateGrokProjectFieldEl.style.display).toBe('none')
    expect(templateGrokProjectUrlEl.value).toBe('')
  })

  it('submits library people with an empty persona', async () => {
    const store = createDefaultStore()
    const {
      view,
      runCommand,
      templateNameEl,
      templatePromptEl,
      peopleLibraryFormEl,
    } = setupPeopleLibraryView({ store, templates: [] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateNameEl.value = '观察员'
    templatePromptEl.value = ''
    peopleLibraryFormEl.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', {
      name: '观察员',
      description: '',
      systemPrompt: '',
      defaultModelSource: 'site',
      defaultChatSite: 'gemini',
      defaultExternalModelId: undefined,
      chatGptGptsUrl: undefined,
      grokProjectUrl: undefined,
    })
  })

  it('fills the new person form from an AI-generated persona draft', async () => {
    const store = createDefaultStore()
    const {
      view,
      generatePersona,
      templateAiDescriptionEl,
      generateTemplatePersonaEl,
      templatePersonaGenerationStatusEl,
      templateNameEl,
      templateDescriptionEl,
      templatePromptEl,
    } = setupPeopleLibraryView({ store, templates: [] })
    generatePersona.mockResolvedValueOnce({
      name: '增长顾问',
      description: '负责从获客、转化和复盘角度给建议。',
      systemPrompt: '你是增长顾问。先判断目标和约束，再给出可执行建议。',
    })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateAiDescriptionEl.value = '一个擅长小红书增长的内容顾问'
    generateTemplatePersonaEl.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(generatePersona).toHaveBeenCalledWith('一个擅长小红书增长的内容顾问')
    expect(templateNameEl.value).toBe('增长顾问')
    expect(templateDescriptionEl.value).toBe('负责从获客、转化和复盘角度给建议。')
    expect(templatePromptEl.value).toBe('你是增长顾问。先判断目标和约束，再给出可执行建议。')
    expect(templatePersonaGenerationStatusEl.textContent).toContain('已生成')
  })

  it('shows a reload hint when the running background does not know the persona generation route', async () => {
    const store = createDefaultStore()
    const {
      view,
      generatePersona,
      showError,
      templateAiDescriptionEl,
      generateTemplatePersonaEl,
    } = setupPeopleLibraryView({ store, templates: [] })
    generatePersona.mockRejectedValueOnce(new Error('Unknown OpenTeam message'))

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateAiDescriptionEl.value = '一个擅长复盘的教练'
    generateTemplatePersonaEl.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(showError).toHaveBeenCalledWith('AI 生成人设需要重新加载 OpenTeam 扩展后再使用')
  })

  it('allows library people names up to 50 characters', async () => {
    const store = createDefaultStore()
    const {
      view,
      runCommand,
      showError,
      templateNameEl,
      peopleLibraryFormEl,
    } = setupPeopleLibraryView({ store, templates: [] })
    const longName = '研'.repeat(50)

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    templateNameEl.value = longName
    peopleLibraryFormEl.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()

    expect(showError).not.toHaveBeenCalled()
    expect(runCommand).toHaveBeenCalledWith('ROLE_TEMPLATE_CREATE', expect.objectContaining({ name: longName }))
  })

  it('filters the people library by built-in and custom tabs', () => {
    const builtinTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      description: '意义顾问',
      defaultChatSite: 'gemini',
      systemPrompt: '弗兰克尔式意义顾问',
      createdAt: 0,
      updatedAt: 0,
    }
    const customTemplate = makeTemplate(1)
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      roleTemplateOrder: [customTemplate.id],
      roleTemplatesById: { [customTemplate.id]: customTemplate },
    }
    const { view, peopleLibraryListEl, peopleLibraryBuiltinTabEl, peopleLibraryCustomTabEl } = setupPeopleLibraryView({ store, templates: [builtinTemplate, customTemplate] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()

    expect(peopleLibraryListEl.textContent).toContain('人员1')
    expect(peopleLibraryListEl.textContent).toContain('自定义')
    expect(peopleLibraryListEl.textContent).not.toContain('弗兰克尔')
    expect(peopleLibraryCustomTabEl.className).toContain('active')
    expect(peopleLibraryListEl.querySelector('.template-delete')).toBeDefined()

    peopleLibraryBuiltinTabEl.click()
    expect(peopleLibraryListEl.textContent).toContain('弗兰克尔')
    expect(peopleLibraryListEl.textContent).toContain('内置')
    expect(peopleLibraryListEl.textContent).not.toContain('人员1')
    expect(peopleLibraryBuiltinTabEl.className).toContain('active')
    expect(peopleLibraryListEl.querySelector('.template-delete')).toBeNull()
  })

  it('renders built-in people library content in English mode', () => {
    const builtinTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      category: '思想风格顾问',
      description: '意义疗法、责任、苦难中的尊严与行动方向',
      defaultChatSite: 'gemini',
      systemPrompt: '你是「弗兰克尔式意义顾问」。',
      createdAt: 0,
      updatedAt: 0,
    }
    const customTemplate = makeTemplate(1)
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      roleTemplateOrder: [customTemplate.id],
      roleTemplatesById: { [customTemplate.id]: customTemplate },
    }
    const { view, peopleLibraryListEl, peopleLibraryBuiltinTabEl } = setupPeopleLibraryView({
      store,
      templates: [builtinTemplate, customTemplate],
      language: 'en',
    })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    peopleLibraryBuiltinTabEl.click()

    expect(peopleLibraryListEl.textContent).toContain('ViktorFrankl')
    expect(peopleLibraryListEl.textContent).toContain('Built-in')
    expect(peopleLibraryListEl.textContent).toContain('Thought-style advisors')
    expect(peopleLibraryListEl.textContent).not.toContain('弗兰克尔')
    expect(peopleLibraryListEl.textContent).not.toContain('内置')
  })

  it('searches people library entries by name, description, and persona text', () => {
    const franklTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      description: '意义顾问',
      defaultChatSite: 'gemini',
      systemPrompt: '苦难中的尊严',
      createdAt: 0,
      updatedAt: 0,
    }
    const camusTemplate: RoleTemplate = {
      id: 'builtin-camus',
      type: 'builtin',
      name: '加缪',
      description: '清醒生活',
      defaultChatSite: 'gemini',
      systemPrompt: '荒诞与反抗',
      createdAt: 0,
      updatedAt: 0,
    }
    const store = createDefaultStore()
    const { view, peopleLibraryListEl, peopleLibrarySearchEl, peopleLibraryPaginationEl } = setupPeopleLibraryView({ store, templates: [franklTemplate, camusTemplate] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    peopleLibrarySearchEl.value = '荒诞'
    peopleLibrarySearchEl.dispatchEvent(new Event('input', { bubbles: true }))

    expect(peopleLibraryListEl.textContent).toContain('加缪')
    expect(peopleLibraryListEl.textContent).not.toContain('弗兰克尔')
    expect(peopleLibraryPaginationEl.textContent).toBe('')

    peopleLibrarySearchEl.value = '没有这个人'
    peopleLibrarySearchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(peopleLibraryListEl.textContent).toContain('没有匹配的内置人员')
  })

  it('filters people library entries by built-in category and source group metadata', () => {
    const templates: RoleTemplate[] = [
      {
        id: 'builtin-agent-prompt',
        type: 'builtin',
        name: 'Prompt规范工程师',
        category: '技术研发',
        sourceTemplateName: 'AI Agent 开发群',
        defaultChatSite: 'deepseek',
        systemPrompt: '负责设计 Agent 提示词规范',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'builtin-study-plan',
        type: 'builtin',
        name: '学习规划师',
        category: '学生与学习',
        sourceTemplateName: '学霸学习群',
        defaultChatSite: 'deepseek',
        systemPrompt: '负责学习计划',
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    const store = createDefaultStore()
    const { view, peopleLibraryListEl, peopleLibrarySearchEl, peopleLibraryCategoryFilterEl } = setupPeopleLibraryView({ store, templates })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    peopleLibraryCategoryFilterEl.querySelector<HTMLButtonElement>('[data-category="技术研发"]')?.click()

    expect(peopleLibraryCategoryFilterEl.textContent).toContain('全部')
    expect(peopleLibraryCategoryFilterEl.textContent).toContain('技术研发')
    expect(peopleLibraryListEl.textContent).toContain('Prompt规范工程师')
    expect(peopleLibraryListEl.textContent).toContain('技术研发')
    expect(peopleLibraryListEl.textContent).toContain('AI Agent 开发群')
    expect(peopleLibraryListEl.textContent).not.toContain('学习规划师')

    peopleLibrarySearchEl.value = '学霸学习'
    peopleLibrarySearchEl.dispatchEvent(new Event('input', { bubbles: true }))

    expect(peopleLibraryListEl.textContent).toContain('当前分类暂无内置人员')
  })

  it('opens a read-only prompt detail modal for built-in people', () => {
    const builtinTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      description: '意义顾问',
      defaultChatSite: 'gemini',
      systemPrompt: '你是「弗兰克尔式意义顾问」。\n必须区分事实、判断和行动建议。',
      createdAt: 0,
      updatedAt: 0,
    }
    const store = createDefaultStore()
    const {
      view,
      peopleLibraryListEl,
      builtinTemplateDetailModalEl,
      builtinTemplateDetailTitleEl,
      builtinTemplateDetailMetaEl,
      builtinTemplateDetailPromptEl,
      closeBuiltinTemplateDetailEl,
    } = setupPeopleLibraryView({ store, templates: [builtinTemplate] })

    view.registerPeopleLibraryEvents()
    view.renderTemplates()
    peopleLibraryListEl.querySelector<HTMLButtonElement>('.template-detail')!.click()

    expect(builtinTemplateDetailModalEl.hidden).toBe(false)
    expect(builtinTemplateDetailTitleEl.textContent).toBe('弗兰克尔')
    expect(builtinTemplateDetailMetaEl.textContent).toContain('内置人员')
    expect(builtinTemplateDetailPromptEl.textContent).toContain('弗兰克尔式意义顾问')
    expect(builtinTemplateDetailPromptEl.textContent).toContain('必须区分事实、判断和行动建议')

    closeBuiltinTemplateDetailEl.click()
    expect(builtinTemplateDetailModalEl.hidden).toBe(true)
  })

  it('filters add-person choices by built-in and custom tabs', () => {
    const builtinTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      description: '意义顾问',
      defaultChatSite: 'gemini',
      systemPrompt: '弗兰克尔式意义顾问',
      createdAt: 0,
      updatedAt: 0,
    }
    const customTemplate = makeTemplate(1)
    const chat = makeChat('chat-1')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      roleTemplateOrder: [customTemplate.id],
      roleTemplatesById: { [customTemplate.id]: customTemplate },
    }
    const { view, addLibraryPeopleListEl, addPersonBuiltinTabEl, addPersonCustomTabEl } = setupPeopleLibraryView({ store, templates: [builtinTemplate, customTemplate], currentChat: chat })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    expect(addLibraryPeopleListEl.textContent).toContain('人员1')
    expect(addLibraryPeopleListEl.textContent).not.toContain('弗兰克尔')
    expect(addPersonCustomTabEl.className).toContain('active')

    addPersonBuiltinTabEl.click()
    expect(addLibraryPeopleListEl.textContent).toContain('弗兰克尔')
    expect(addLibraryPeopleListEl.textContent).not.toContain('人员1')
    expect(addPersonBuiltinTabEl.className).toContain('active')
  })

  it('shows default custom people in the add-person custom tab for a default store', () => {
    const store = createDefaultStore()
    const chat = makeChat('chat-1')
    store.currentChatId = chat.id
    store.chatOrder = [chat.id]
    store.chatsById[chat.id] = chat
    const { view, addLibraryPeopleListEl, addPersonCustomTabEl } = setupPeopleLibraryView({
      store,
      templates: getAllRoleTemplates(store),
      currentChat: chat,
    })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    addPersonCustomTabEl.click()

    expect(addLibraryPeopleListEl.textContent).toContain('产品经理')
    expect(addLibraryPeopleListEl.textContent).toContain('工程师')
    expect(addLibraryPeopleListEl.textContent).toContain('增长顾问')
  })

  it('searches add-person choices by name, description, and persona text', () => {
    const builtinTemplate: RoleTemplate = {
      id: 'builtin-frankl',
      type: 'builtin',
      name: '弗兰克尔',
      description: '意义顾问',
      defaultChatSite: 'gemini',
      systemPrompt: '苦难中的尊严',
      createdAt: 0,
      updatedAt: 0,
    }
    const camusTemplate: RoleTemplate = {
      id: 'builtin-camus',
      type: 'builtin',
      name: '加缪',
      description: '清醒生活',
      defaultChatSite: 'gemini',
      systemPrompt: '荒诞与反抗',
      createdAt: 0,
      updatedAt: 0,
    }
    const chat = makeChat('chat-1')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
    }
    const { view, addLibraryPeopleListEl, addPersonSearchEl } = setupPeopleLibraryView({ store, templates: [builtinTemplate, camusTemplate], currentChat: chat })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    addPersonSearchEl.value = '荒诞'
    addPersonSearchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(addLibraryPeopleListEl.textContent).toContain('加缪')
    expect(addLibraryPeopleListEl.textContent).not.toContain('弗兰克尔')

    addPersonSearchEl.value = '没有这个人'
    addPersonSearchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(addLibraryPeopleListEl.textContent).toContain('没有匹配的内置人员')
  })

  it('filters add-person choices by built-in category while keeping selected people checked', () => {
    const templates: RoleTemplate[] = [
      {
        id: 'builtin-agent-prompt',
        type: 'builtin',
        name: 'Prompt规范工程师',
        category: '技术研发',
        sourceTemplateName: 'AI Agent 开发群',
        defaultChatSite: 'deepseek',
        systemPrompt: '负责设计 Agent 提示词规范',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'builtin-study-plan',
        type: 'builtin',
        name: '学习规划师',
        category: '学生与学习',
        sourceTemplateName: '学霸学习群',
        defaultChatSite: 'deepseek',
        systemPrompt: '负责学习计划',
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    const chat = makeChat('chat-1')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
    }
    const { view, addLibraryPeopleListEl, addPersonBuiltinTabEl, addPersonCategoryFilterEl, addPersonSearchEl } = setupPeopleLibraryView({ store, templates, currentChat: chat })

    view.registerPeopleLibraryEvents()
    view.renderAddPersonDialog()
    addPersonBuiltinTabEl.click()
    addPersonCategoryFilterEl.querySelector<HTMLButtonElement>('[data-category="技术研发"]')?.click()
    const promptPerson = addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:builtin-agent-prompt"]')!
    promptPerson.checked = true
    promptPerson.dispatchEvent(new Event('change', { bubbles: true }))

    expect(addLibraryPeopleListEl.textContent).toContain('Prompt规范工程师')
    expect(addLibraryPeopleListEl.textContent).toContain('技术研发')
    expect(addLibraryPeopleListEl.textContent).toContain('AI Agent 开发群')
    expect(addLibraryPeopleListEl.textContent).not.toContain('学习规划师')

    addPersonSearchEl.value = '学习'
    addPersonSearchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(addLibraryPeopleListEl.textContent).toContain('当前分类暂无内置人员')

    addPersonSearchEl.value = ''
    addPersonSearchEl.dispatchEvent(new Event('input', { bubbles: true }))
    expect(addLibraryPeopleListEl.querySelector<HTMLInputElement>('input[type="checkbox"][value="library:builtin-agent-prompt"]')!.checked).toBe(true)
  })
})
