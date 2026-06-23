import { ROLE_NAME_MAX_CHARACTERS } from '../group/roleTemplates'
import type { GeneratedPersonDraft } from '../group/personaGeneration'
import type { ChatSite, ExternalModelConfig, GroupChat, OpenTeamStore, RoleModelSource, RoleTemplate } from '../group/types'
import { localizeCategory, localizeRoleTemplate, normalizeLanguage, translateUi, type TeamLanguage } from '../shared/i18n'
import type { TeamPageState } from './appState'

type TemplateDraft = Pick<RoleTemplate, 'name' | 'description' | 'systemPrompt' | 'defaultModelSource' | 'defaultChatSite' | 'defaultExternalModelId' | 'chatGptGptsUrl' | 'grokProjectUrl'>
type AddPersonItem =
  | { key: string; source: 'library'; type: RoleTemplate['type']; roleTemplateId: string; name: string; category?: string; sourceTemplateId?: string; sourceTemplateName?: string; description?: string; systemPrompt: string; chatSites: string[]; disabledSites: Set<string> }
  | { key: string; source: 'temporary'; type: 'custom'; draftId: string; name: string; category?: string; sourceTemplateName?: string; description?: string; systemPrompt: string; chatSites: string[]; disabledSites: Set<string> }

const TEMPLATE_CATEGORY_ALL = '全部'
const PEOPLE_LIBRARY_PAGE_SIZE = 5
const VISIBLE_CHAT_SITES = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok', 'qwen'] as const

export interface PeopleLibraryViewDependencies {
  state: TeamPageState
  getStore(): OpenTeamStore
  settingsButtonEl: HTMLButtonElement
  settingsMenuEl: HTMLElement
  openPeopleLibraryEl: HTMLButtonElement
  closePeopleLibraryEl: HTMLButtonElement
  peopleLibraryModalEl: HTMLElement
  personTemplateModalEl: HTMLElement
  addPersonModalEl: HTMLElement
  temporaryPersonModalEl: HTMLElement
  peopleLibrarySummaryEl: HTMLElement
  peopleLibraryListEl: HTMLElement
  peopleLibraryPaginationEl: HTMLElement
  peopleLibrarySearchEl: HTMLInputElement
  peopleLibraryCategoryFilterEl: HTMLElement
  peopleLibraryBuiltinTabEl: HTMLButtonElement
  peopleLibraryCustomTabEl: HTMLButtonElement
  addLibraryPeopleListEl: HTMLElement
  addPersonSearchEl: HTMLInputElement
  addPersonCategoryFilterEl: HTMLElement
  addPersonBuiltinTabEl: HTMLButtonElement
  addPersonCustomTabEl: HTMLButtonElement
  builtinTemplateDetailModalEl: HTMLElement
  builtinTemplateDetailTitleEl: HTMLElement
  builtinTemplateDetailMetaEl: HTMLElement
  builtinTemplateDetailPromptEl: HTMLElement
  closeBuiltinTemplateDetailEl: HTMLButtonElement
  roleTemplateSelectEl: HTMLSelectElement
  templateListEl: HTMLElement
  templateNameEl: HTMLInputElement
  templateDescriptionEl: HTMLTextAreaElement
  templatePromptEl: HTMLTextAreaElement
  templateAiDescriptionEl: HTMLTextAreaElement
  generateTemplatePersonaEl: HTMLButtonElement
  templatePersonaGenerationStatusEl: HTMLElement
  templateFormTitleEl: HTMLElement
  templateSiteGeminiEl: HTMLInputElement
  templateSiteChatGptEl: HTMLInputElement
  templateSiteClaudeEl: HTMLInputElement
  templateSiteDeepSeekEl: HTMLInputElement
  templateSiteGrokEl: HTMLInputElement
  templateSiteQwenEl: HTMLInputElement
  templateSiteExternalEl: HTMLInputElement
  templateExternalModelFieldEl: HTMLElement
  templateExternalModelSelectEl: HTMLSelectElement
  templateChatGptGptsFieldEl: HTMLElement
  templateChatGptGptsUrlEl: HTMLInputElement
  templateGrokProjectFieldEl: HTMLElement
  templateGrokProjectUrlEl: HTMLInputElement
  temporaryPersonNameEl: HTMLInputElement
  temporaryPersonDescriptionEl: HTMLTextAreaElement
  temporaryPersonPromptEl: HTMLTextAreaElement
  newTemplateEl: HTMLButtonElement
  closePersonTemplateEl: HTMLButtonElement
  closeAddPersonEl: HTMLButtonElement
  openTemporaryPersonEl: HTMLButtonElement
  closeTemporaryPersonEl: HTMLButtonElement
  addRoleFormEl: HTMLFormElement
  addLibraryPeopleFormEl: HTMLFormElement
  addTemporaryPersonFormEl: HTMLFormElement
  peopleLibraryFormEl: HTMLFormElement
  getCurrentChat(): GroupChat | undefined
  getTemplates(): RoleTemplate[]
  emptyCard(title: string, body: string): HTMLElement
  generatePersona(description: string): Promise<GeneratedPersonDraft>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
  log: {
    info(event: string, details?: Record<string, unknown>): void
  }
}

export interface PeopleLibraryView {
  closePeopleModals(): void
  openAddPersonDialog(): void
  registerPeopleLibraryEvents(): void
  renderAddPersonDialog(): void
  renderTemplates(): void
}

export function createPeopleLibraryView(deps: PeopleLibraryViewDependencies): PeopleLibraryView {
  function renderTemplates(): void {
    const allTemplates = deps.getTemplates()
    ensurePeopleLibraryTemplateTypeHasItems()
    syncPeopleLibraryTypeTabs()
    renderPeopleLibraryCategoryFilter()
    const templates = filteredPeopleLibraryTemplates()
    deps.peopleLibrarySummaryEl.textContent = ui(`${templates.length} 人`)
    deps.roleTemplateSelectEl.replaceChildren(new Option(ui('不使用人员库，手动创建'), ''))
    for (const template of allTemplates) deps.roleTemplateSelectEl.append(new Option(displayRoleTemplate(template).name, template.id))

    deps.templateListEl.replaceChildren()
    deps.peopleLibraryListEl.replaceChildren()
    deps.peopleLibraryPaginationEl.replaceChildren()
    if (templates.length === 0) {
      deps.peopleLibraryListEl.append(deps.emptyCard(
        ui(deps.state.peopleLibrarySearchQuery.trim() ? `没有匹配的${deps.state.peopleLibraryTemplateType === 'builtin' ? '内置' : '自定义'}人员` : `暂无${deps.state.peopleLibraryTemplateType === 'builtin' ? '内置' : '自定义'}人员`),
        peopleLibraryEmptyBody(),
      ))
    } else {
      const visibleTemplates = pagedTemplates(templates)
      for (const template of visibleTemplates) {
        const card = templateCard(template)
        deps.templateListEl.append(card.cloneNode(true))
        deps.peopleLibraryListEl.append(card)
      }
      renderPeopleLibraryPagination(templates.length)
    }
    if (!deps.personTemplateModalEl.hidden) renderTemplateEditor()
  }

  function renderTemplateEditor(): void {
    const store = deps.getStore()
    const selectedTemplate = deps.state.selectedTemplateId ? store.roleTemplatesById[deps.state.selectedTemplateId] : undefined
    deps.templateFormTitleEl.textContent = selectedTemplate ? ui(`编辑人员：${selectedTemplate.name}`) : ui('新建人员')
    deps.templateAiDescriptionEl.value = ''
    deps.templatePersonaGenerationStatusEl.textContent = ''
    deps.generateTemplatePersonaEl.disabled = false
    deps.generateTemplatePersonaEl.textContent = ui('AI 生成')
    renderExternalModelSelect()
    if (selectedTemplate) {
      const defaultChatSite = visibleChatSite(selectedTemplate.defaultChatSite ?? store.settings.defaultChatSite)
      const externalSelected = selectedTemplate.defaultModelSource === 'external' && Boolean(selectedTemplate.defaultExternalModelId)
      deps.templateNameEl.value = selectedTemplate.name
      deps.templateDescriptionEl.value = selectedTemplate.description ?? ''
      deps.templatePromptEl.value = selectedTemplate.systemPrompt
      deps.templateSiteGeminiEl.checked = !externalSelected && defaultChatSite === 'gemini'
      deps.templateSiteChatGptEl.checked = !externalSelected && defaultChatSite === 'chatgpt'
      deps.templateSiteClaudeEl.checked = !externalSelected && defaultChatSite === 'claude'
      deps.templateSiteDeepSeekEl.checked = !externalSelected && defaultChatSite === 'deepseek'
      deps.templateSiteGrokEl.checked = !externalSelected && defaultChatSite === 'grok'
      deps.templateSiteQwenEl.checked = !externalSelected && defaultChatSite === 'qwen'
      deps.templateSiteExternalEl.checked = externalSelected
      deps.templateExternalModelSelectEl.value = selectedTemplate.defaultExternalModelId ?? firstExternalModelId() ?? ''
      deps.templateChatGptGptsUrlEl.value = selectedTemplate.chatGptGptsUrl ?? ''
      deps.templateGrokProjectUrlEl.value = selectedTemplate.grokProjectUrl ?? ''
      syncTemplateModelFields()
    } else {
      deps.templateNameEl.value = ''
      deps.templateDescriptionEl.value = ''
      deps.templatePromptEl.value = ''
      const defaultChatSite = visibleChatSite(store.settings.defaultChatSite)
      deps.templateSiteGeminiEl.checked = defaultChatSite === 'gemini'
      deps.templateSiteChatGptEl.checked = defaultChatSite === 'chatgpt'
      deps.templateSiteClaudeEl.checked = defaultChatSite === 'claude'
      deps.templateSiteDeepSeekEl.checked = defaultChatSite === 'deepseek'
      deps.templateSiteGrokEl.checked = defaultChatSite === 'grok'
      deps.templateSiteQwenEl.checked = defaultChatSite === 'qwen'
      deps.templateSiteExternalEl.checked = false
      deps.templateExternalModelSelectEl.value = firstExternalModelId() ?? ''
      deps.templateChatGptGptsUrlEl.value = ''
      deps.templateGrokProjectUrlEl.value = ''
      syncTemplateModelFields()
    }
  }

  function openTemplateEditor(templateId?: string): void {
    deps.state.selectedTemplateId = templateId
    renderTemplateEditor()
    deps.personTemplateModalEl.hidden = false
    deps.templateNameEl.focus()
  }

  function closeTemplateEditor(): void {
    deps.personTemplateModalEl.hidden = true
    deps.state.selectedTemplateId = undefined
  }

  function openAddPersonDialog(): void {
    if (!deps.getCurrentChat()) return
    deps.addPersonModalEl.hidden = false
    deps.state.addPersonSiteMenuId = undefined
    deps.state.addPersonSelectedKeys.clear()
    deps.state.addPersonTemplateType = 'custom'
    deps.state.addPersonSearchQuery = ''
    deps.state.addPersonCategory = TEMPLATE_CATEGORY_ALL
    deps.addPersonSearchEl.value = ''
    deps.log.info('ui:person-add-dialog:open', { chatId: deps.getCurrentChat()?.id, source: 'mixed' })
    renderAddPersonDialog()
  }

  function openTemporaryPersonDialog(): void {
    deps.temporaryPersonNameEl.value = ''
    deps.temporaryPersonDescriptionEl.value = ''
    deps.temporaryPersonPromptEl.value = ''
    deps.temporaryPersonModalEl.hidden = false
    deps.temporaryPersonNameEl.focus()
  }

  function closeTemporaryPersonDialog(): void {
    deps.temporaryPersonModalEl.hidden = true
  }

  function closePeopleModals(): void {
    deps.peopleLibraryModalEl.hidden = true
    deps.personTemplateModalEl.hidden = true
    deps.addPersonModalEl.hidden = true
    deps.temporaryPersonModalEl.hidden = true
    deps.builtinTemplateDetailModalEl.hidden = true
    deps.state.selectedTemplateId = undefined
    deps.state.previewTemplateId = undefined
    deps.state.addPersonSiteMenuId = undefined
    deps.state.peopleLibraryTemplateType = 'custom'
    deps.state.peopleLibrarySearchQuery = ''
    deps.state.peopleLibraryCategory = TEMPLATE_CATEGORY_ALL
    deps.state.addPersonTemplateType = 'custom'
    deps.state.addPersonSearchQuery = ''
    deps.state.addPersonCategory = TEMPLATE_CATEGORY_ALL
    deps.state.addPersonSelectedKeys.clear()
  }

  function registerPeopleLibraryEvents(): void {
    deps.openPeopleLibraryEl.addEventListener('click', () => {
      deps.settingsMenuEl.hidden = true
      deps.settingsButtonEl.setAttribute('aria-expanded', 'false')
      deps.peopleLibraryModalEl.hidden = false
      deps.state.peopleLibraryPage = 0
      deps.state.peopleLibraryTemplateType = 'custom'
      deps.state.peopleLibrarySearchQuery = ''
      deps.state.peopleLibraryCategory = TEMPLATE_CATEGORY_ALL
      deps.peopleLibrarySearchEl.value = ''
      deps.log.info('ui:people-library:open', { templateCount: deps.getTemplates().length })
      renderTemplates()
    })

    deps.closePeopleLibraryEl.addEventListener('click', () => {
      deps.peopleLibraryModalEl.hidden = true
    })

    deps.newTemplateEl.addEventListener('click', () => openTemplateEditor())
    deps.closePersonTemplateEl.addEventListener('click', closeTemplateEditor)
    deps.closeBuiltinTemplateDetailEl.addEventListener('click', closeBuiltinTemplateDetail)
    deps.generateTemplatePersonaEl.addEventListener('click', () => {
      generateTemplatePersona().catch(error => deps.showError(personaGenerationErrorMessage(error)))
    })
    for (const input of templateSiteInputs()) {
      input.addEventListener('change', syncTemplateModelFields)
    }

    deps.peopleLibrarySearchEl.addEventListener('input', () => {
      deps.state.peopleLibrarySearchQuery = deps.peopleLibrarySearchEl.value
      deps.state.peopleLibraryPage = 0
      renderTemplates()
    })
    deps.peopleLibraryBuiltinTabEl.addEventListener('click', () => {
      deps.state.peopleLibraryTemplateType = 'builtin'
      deps.state.peopleLibraryCategory = TEMPLATE_CATEGORY_ALL
      deps.state.peopleLibraryPage = 0
      renderTemplates()
    })
    deps.peopleLibraryCustomTabEl.addEventListener('click', () => {
      deps.state.peopleLibraryTemplateType = 'custom'
      deps.state.peopleLibraryCategory = TEMPLATE_CATEGORY_ALL
      deps.state.peopleLibraryPage = 0
      renderTemplates()
    })

    deps.closeAddPersonEl.addEventListener('click', () => {
      deps.addPersonModalEl.hidden = true
      deps.state.addPersonSiteMenuId = undefined
      deps.state.addPersonSelectedKeys.clear()
    })

    deps.addPersonSearchEl.addEventListener('input', () => {
      deps.state.addPersonSearchQuery = deps.addPersonSearchEl.value
      renderAddPersonDialog()
    })
    deps.addPersonBuiltinTabEl.addEventListener('click', () => {
      deps.state.addPersonTemplateType = 'builtin'
      deps.state.addPersonCategory = TEMPLATE_CATEGORY_ALL
      renderAddPersonDialog()
    })
    deps.addPersonCustomTabEl.addEventListener('click', () => {
      deps.state.addPersonTemplateType = 'custom'
      deps.state.addPersonCategory = TEMPLATE_CATEGORY_ALL
      renderAddPersonDialog()
    })

    deps.openTemporaryPersonEl.addEventListener('click', openTemporaryPersonDialog)
    deps.closeTemporaryPersonEl.addEventListener('click', closeTemporaryPersonDialog)

    deps.addRoleFormEl.addEventListener('submit', event => {
      event.preventDefault()
      openAddPersonDialog()
    })

    deps.addLibraryPeopleFormEl.addEventListener('submit', event => {
      event.preventDefault()
      addPeopleToCurrentChat(selectedAddPersonItems())
        .then(() => {
          deps.addPersonModalEl.hidden = true
          deps.state.addPersonSiteMenuId = undefined
          deps.state.addPersonSelectedKeys.clear()
          deps.state.temporaryPersonDrafts.splice(0)
        })
        .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    deps.addTemporaryPersonFormEl.addEventListener('submit', event => {
      event.preventDefault()
      const draft = {
        name: deps.temporaryPersonNameEl.value.trim(),
        description: deps.temporaryPersonDescriptionEl.value.trim(),
        systemPrompt: deps.temporaryPersonPromptEl.value.trim(),
      }
      const validationError = validatePersonDraft(draft)
      if (validationError) {
        deps.showError(validationError)
        return
      }
      const id = `temporary-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const store = deps.getStore()
      const chatSite = visibleChatSite(store.settings.defaultChatSite)
      deps.state.temporaryPersonDrafts.push({ id, ...draft, chatSite })
      deps.state.addPersonSiteByKey.set(`temporary:${id}`, new Set([modelKeyForSite(chatSite)]))
      closeTemporaryPersonDialog()
      renderAddPersonDialog()
    })

    deps.peopleLibraryFormEl.addEventListener('submit', event => {
      event.preventDefault()
      const draft = readTemplateDraft()
      const validationError = validatePersonDraft(draft)
      if (validationError) {
        deps.showError(validationError)
        return
      }
      const type = deps.state.selectedTemplateId ? 'ROLE_TEMPLATE_UPDATE' : 'ROLE_TEMPLATE_CREATE'
      const payload = deps.state.selectedTemplateId ? { templateId: deps.state.selectedTemplateId, ...draft } : draft
      deps.runCommand(type, payload)
        .then(closeTemplateEditor)
        .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
  }

  function templateCard(template: RoleTemplate): HTMLElement {
    const store = deps.getStore()
    const displayTemplate = displayRoleTemplate(template)
    const card = document.createElement('section')
    card.className = 'template-card'

    const body = document.createElement('div')
    body.className = 'template-card-body'
    const row = document.createElement('div')
    row.className = 'role-row'
    const name = document.createElement('div')
    name.className = 'role-name'
    name.textContent = displayTemplate.name
    const used = document.createElement('span')
    used.className = `template-type-badge template-type-${template.type}`
    used.textContent = template.type === 'builtin' ? ui('内置') : ui('自定义')
    row.append(name, used)

    const description = document.createElement('div')
    description.className = 'template-description'
    description.textContent = displayTemplate.description || ui('未填写人员库描述')
    const site = document.createElement('div')
    site.className = 'template-description'
    const defaultChatSite = visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite)
    site.textContent = ui(`默认模型：${templateModelLabel(template, store)}${defaultChatSite === 'chatgpt' && template.chatGptGptsUrl ? ' · GPTs' : defaultChatSite === 'grok' && template.grokProjectUrl ? ' · Project' : ''}`)
    const meta = document.createElement('div')
    meta.className = 'template-description template-meta'
    meta.textContent = templateMetaText(displayTemplate, language())
    body.append(row, description, meta, site)

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'btn btn-ghost template-edit'
    edit.textContent = ui('编辑')
    edit.addEventListener('click', event => {
      event.stopPropagation()
      openTemplateEditor(template.id)
    })

    const actions = document.createElement('div')
    actions.className = 'template-card-actions'
    if (template.type === 'builtin') {
      const detail = document.createElement('button')
      detail.type = 'button'
      detail.className = 'btn btn-ghost template-detail'
      detail.textContent = ui('详情')
      detail.addEventListener('click', event => {
        event.stopPropagation()
        openBuiltinTemplateDetail(template)
      })
      actions.append(detail)
    } else {
      actions.append(edit)
    }

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-danger template-delete'
    remove.textContent = ui('删除')
    remove.addEventListener('click', event => {
      event.stopPropagation()
      deleteTemplate(template)
    })
    if (template.type !== 'builtin') {
      if (!isTemplateUsed(template.id)) actions.append(remove)
    }

    card.append(body, actions)
    return card
  }

  function pagedTemplates(templates: RoleTemplate[]): RoleTemplate[] {
    const pageCount = Math.max(1, Math.ceil(templates.length / PEOPLE_LIBRARY_PAGE_SIZE))
    deps.state.peopleLibraryPage = Math.min(Math.max(0, deps.state.peopleLibraryPage), pageCount - 1)
    const start = deps.state.peopleLibraryPage * PEOPLE_LIBRARY_PAGE_SIZE
    return templates.slice(start, start + PEOPLE_LIBRARY_PAGE_SIZE)
  }

  function renderPeopleLibraryPagination(total: number): void {
    const pageCount = Math.max(1, Math.ceil(total / PEOPLE_LIBRARY_PAGE_SIZE))
    if (pageCount <= 1) return

    const previous = paginationButton(ui('上一页'), deps.state.peopleLibraryPage === 0, () => {
      deps.state.peopleLibraryPage = Math.max(0, deps.state.peopleLibraryPage - 1)
      renderTemplates()
    })
    const next = paginationButton(ui('下一页'), deps.state.peopleLibraryPage >= pageCount - 1, () => {
      deps.state.peopleLibraryPage = Math.min(pageCount - 1, deps.state.peopleLibraryPage + 1)
      renderTemplates()
    })
    const label = document.createElement('span')
    label.className = 'pagination-label'
    label.textContent = `${deps.state.peopleLibraryPage + 1} / ${pageCount}`
    deps.peopleLibraryPaginationEl.append(previous, label, next)
  }

  function paginationButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-ghost pagination-btn'
    button.textContent = label
    button.disabled = disabled
    button.addEventListener('click', onClick)
    return button
  }

  function renderAddPersonDialog(): void {
    ensureAddPersonTemplateTypeHasItems()
    syncAddPersonTypeTabs()
    renderAddPersonCategoryFilter()
    const items = filteredAddPersonItems()
    deps.addLibraryPeopleListEl.replaceChildren()
    if (items.length === 0) {
      deps.addLibraryPeopleListEl.append(deps.emptyCard(
        ui(deps.state.addPersonSearchQuery.trim() ? `没有匹配的${deps.state.addPersonTemplateType === 'builtin' ? '内置' : '自定义'}人员` : `暂无${deps.state.addPersonTemplateType === 'builtin' ? '内置' : '自定义'}人员`),
        addPersonEmptyBody(),
      ))
      return
    }

    for (const item of items) {
      const displayItem = displayAddPersonItem(item)
      const label = document.createElement('div')
      label.className = 'select-row'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.value = item.key
      checkbox.disabled = item.chatSites.length === 0
      checkbox.checked = deps.state.addPersonSelectedKeys.has(item.key)
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          deps.state.addPersonSelectedKeys.add(item.key)
        } else {
          deps.state.addPersonSelectedKeys.delete(item.key)
        }
      })
      const content = document.createElement('span')
      content.className = 'select-row-content'
      const name = document.createElement('strong')
      name.textContent = displayItem.name
      const description = document.createElement('div')
      description.className = 'template-description'
      description.textContent = displayItem.description || ui('未填写描述')
      const site = document.createElement('div')
      site.className = 'template-description'
      site.textContent = item.chatSites.length === 0 ? ui('所有可用站点已添加') : item.source === 'temporary' ? ui('临时人员') : addPersonMetaText(displayItem, language())
      content.append(name, description, site)
      label.append(checkbox, content, addPersonSiteControl(item.key, item.chatSites, item.disabledSites))
      deps.addLibraryPeopleListEl.append(label)
    }
  }

  function filteredPeopleLibraryTemplates(): RoleTemplate[] {
    return deps.getTemplates().filter(template => (
      template.type === deps.state.peopleLibraryTemplateType &&
      matchesTemplateCategory(template, deps.state.peopleLibraryCategory) &&
      matchesTemplateSearch(template, deps.state.peopleLibrarySearchQuery)
    ))
  }

  function ensurePeopleLibraryTemplateTypeHasItems(): void {
    if (deps.state.peopleLibrarySearchQuery.trim()) return
    const templates = deps.getTemplates()
    if (templates.some(template => template.type === deps.state.peopleLibraryTemplateType)) return
    const fallbackType = deps.state.peopleLibraryTemplateType === 'builtin' ? 'custom' : 'builtin'
    if (templates.some(template => template.type === fallbackType)) deps.state.peopleLibraryTemplateType = fallbackType
  }

  function matchesTemplateSearch(template: RoleTemplate, queryValue: string): boolean {
    const query = queryValue.trim().toLowerCase()
    if (!query) return true
    const displayTemplate = displayRoleTemplate(template)
    return [
      template.name,
      template.category ?? '',
      template.sourceTemplateName ?? '',
      template.description ?? '',
      template.systemPrompt,
      displayTemplate.name,
      displayTemplate.category ?? '',
      displayTemplate.sourceTemplateName ?? '',
      displayTemplate.description ?? '',
      displayTemplate.systemPrompt,
    ].some(value => value.toLowerCase().includes(query))
  }

  function matchesTemplateCategory(template: RoleTemplate, category: string): boolean {
    return category === TEMPLATE_CATEGORY_ALL || template.category === category
  }

  function renderPeopleLibraryCategoryFilter(): void {
    renderCategoryFilter(
      deps.peopleLibraryCategoryFilterEl,
      categoryOptionsForTemplates(deps.getTemplates().filter(template => template.type === deps.state.peopleLibraryTemplateType)),
      deps.state.peopleLibraryCategory,
      category => {
        deps.state.peopleLibraryCategory = category
        deps.state.peopleLibraryPage = 0
        renderTemplates()
      },
      language(),
    )
  }

  function peopleLibraryEmptyBody(): string {
    if (deps.state.peopleLibraryCategory !== TEMPLATE_CATEGORY_ALL) return ui(`当前分类暂无${deps.state.peopleLibraryTemplateType === 'builtin' ? '内置' : '自定义'}人员`)
    return ui(deps.state.peopleLibraryTemplateType === 'builtin' ? '可以切换到自定义人员，或调整搜索词。' : '点击右上角新建人员，保存后会出现在这里。')
  }

  function syncPeopleLibraryTypeTabs(): void {
    const builtinActive = deps.state.peopleLibraryTemplateType === 'builtin'
    deps.peopleLibraryBuiltinTabEl.className = `template-type-tab${builtinActive ? ' active' : ''}`
    deps.peopleLibraryCustomTabEl.className = `template-type-tab${builtinActive ? '' : ' active'}`
    deps.peopleLibraryBuiltinTabEl.setAttribute('aria-selected', String(builtinActive))
    deps.peopleLibraryCustomTabEl.setAttribute('aria-selected', String(!builtinActive))
  }

  function openBuiltinTemplateDetail(template: RoleTemplate): void {
    const displayTemplate = displayRoleTemplate(template)
    deps.state.previewTemplateId = template.id
    deps.builtinTemplateDetailTitleEl.textContent = displayTemplate.name
    deps.builtinTemplateDetailMetaEl.textContent = `${templateMetaText(displayTemplate, language())} · ${ui(`默认模型：${templateModelLabel(template, deps.getStore())}`)}`
    deps.builtinTemplateDetailPromptEl.textContent = displayTemplate.systemPrompt || ui('未填写提示词')
    deps.builtinTemplateDetailModalEl.hidden = false
  }

  function closeBuiltinTemplateDetail(): void {
    deps.builtinTemplateDetailModalEl.hidden = true
    deps.state.previewTemplateId = undefined
  }

  function addPersonItems(): AddPersonItem[] {
    const store = deps.getStore()
    const libraryItems = deps.getTemplates().map(template => {
      const key = `library:${template.id}`
      const disabledSites = usedLibrarySites(template)
      const chatSites = selectedAddPersonSites(key, defaultModelKeyForTemplate(template, store), disabledSites)
      return {
        key,
        source: 'library' as const,
        type: template.type,
        roleTemplateId: template.id,
        name: template.name,
        category: template.category,
        sourceTemplateId: template.sourceTemplateId,
        sourceTemplateName: template.sourceTemplateName,
        description: template.description,
        systemPrompt: template.systemPrompt,
        chatSites,
        disabledSites,
      }
    })
    const temporaryItems = deps.state.temporaryPersonDrafts.map(draft => {
      const key = `temporary:${draft.id}`
      const disabledSites = usedNameSites(draft.name)
      const chatSites = selectedAddPersonSites(key, modelKeyForSite(draft.chatSite), disabledSites)
      return {
        key,
        source: 'temporary' as const,
        type: 'custom' as const,
        draftId: draft.id,
        name: draft.name,
        description: draft.description,
        systemPrompt: draft.systemPrompt,
        chatSites,
        disabledSites,
      }
    })
    return [...libraryItems, ...temporaryItems]
  }

  function filteredAddPersonItems(): AddPersonItem[] {
    return addPersonItems().filter(item => (
      item.type === deps.state.addPersonTemplateType &&
      matchesItemCategory(item, deps.state.addPersonCategory) &&
      matchesAddPersonSearch(item)
    ))
  }

  function ensureAddPersonTemplateTypeHasItems(): void {
    if (deps.state.addPersonSearchQuery.trim()) return
    const items = addPersonItems()
    if (items.some(item => item.type === deps.state.addPersonTemplateType)) return
    const fallbackType = deps.state.addPersonTemplateType === 'builtin' ? 'custom' : 'builtin'
    if (items.some(item => item.type === fallbackType)) deps.state.addPersonTemplateType = fallbackType
  }

  function matchesAddPersonSearch(item: AddPersonItem): boolean {
    const query = deps.state.addPersonSearchQuery.trim().toLowerCase()
    if (!query) return true
    const displayItem = displayAddPersonItem(item)
    return [
      item.name,
      item.category ?? '',
      item.sourceTemplateName ?? '',
      item.description ?? '',
      item.systemPrompt,
      displayItem.name,
      displayItem.category ?? '',
      displayItem.sourceTemplateName ?? '',
      displayItem.description ?? '',
      displayItem.systemPrompt,
    ].some(value => value.toLowerCase().includes(query))
  }

  function matchesItemCategory(item: AddPersonItem, category: string): boolean {
    return category === TEMPLATE_CATEGORY_ALL || item.category === category
  }

  function renderAddPersonCategoryFilter(): void {
    renderCategoryFilter(
      deps.addPersonCategoryFilterEl,
      categoryOptionsForItems(addPersonItems().filter(item => item.type === deps.state.addPersonTemplateType)),
      deps.state.addPersonCategory,
      category => {
        deps.state.addPersonCategory = category
        renderAddPersonDialog()
      },
      language(),
    )
  }

  function addPersonEmptyBody(): string {
    if (deps.state.addPersonCategory !== TEMPLATE_CATEGORY_ALL) return ui(`当前分类暂无${deps.state.addPersonTemplateType === 'builtin' ? '内置' : '自定义'}人员`)
    return ui(deps.state.addPersonTemplateType === 'builtin' ? '可以切换到自定义人员，或调整搜索词。' : '先在人员库中新建人员，或点击右上角临时添加。')
  }

  function syncAddPersonTypeTabs(): void {
    const builtinActive = deps.state.addPersonTemplateType === 'builtin'
    deps.addPersonBuiltinTabEl.className = `template-type-tab${builtinActive ? ' active' : ''}`
    deps.addPersonCustomTabEl.className = `template-type-tab${builtinActive ? '' : ' active'}`
    deps.addPersonBuiltinTabEl.setAttribute('aria-selected', String(builtinActive))
    deps.addPersonCustomTabEl.setAttribute('aria-selected', String(!builtinActive))
  }

  function addPersonSiteControl(itemKey: string, chatSites: string[], disabledSites: Set<string>): HTMLElement {
    const control = document.createElement('div')
    control.className = 'role-site-control add-person-site-control'
    const selectedSites = new Set(chatSites)
    for (const model of selectableModels(deps.getStore())) {
      const option = document.createElement('label')
      option.className = `site-pill ${model.className} add-person-site-option${selectedSites.has(model.key) ? ' active' : ''}${disabledSites.has(model.key) ? ' disabled' : ''}`
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.value = model.key
      input.checked = selectedSites.has(model.key)
      input.disabled = disabledSites.has(model.key)
      input.addEventListener('change', event => {
        event.stopPropagation()
        if (disabledSites.has(model.key)) return
        const nextSites = new Set(selectedAddPersonSites(itemKey, model.key, disabledSites))
        if (input.checked) {
          nextSites.add(model.key)
        } else if (nextSites.size > 1) {
          nextSites.delete(model.key)
        } else {
          input.checked = true
          return
        }
        deps.state.addPersonSiteByKey.set(itemKey, nextSites)
        renderAddPersonDialog()
      })
      option.append(input, document.createTextNode(model.label))
      control.append(option)
    }
    return control
  }

  function selectedAddPersonSites(itemKey: string, fallbackSite: string, disabledSites = new Set<string>()): string[] {
    const selectedSites = deps.state.addPersonSiteByKey.get(itemKey)
    const modelKeys = selectableModels(deps.getStore()).map(model => model.key)
    const visibleSelectedSites = selectedSites ? modelKeys.filter(site => selectedSites.has(site) && !disabledSites.has(site)) : []
    if (visibleSelectedSites.length > 0) return visibleSelectedSites

    const fallback = modelKeys.includes(fallbackSite) ? fallbackSite : modelKeyForSite(visibleChatSite(deps.getStore().settings.defaultChatSite))
    const nextSite = disabledSites.has(fallback) ? modelKeys.find(site => !disabledSites.has(site)) : fallback
    if (!nextSite) {
      deps.state.addPersonSiteByKey.set(itemKey, new Set())
      return []
    }
    deps.state.addPersonSiteByKey.set(itemKey, new Set([nextSite]))
    return [nextSite]
  }

  function usedLibrarySites(template: RoleTemplate): Set<string> {
    const chat = deps.getCurrentChat()
    if (!chat) return new Set()
    const store = deps.getStore()
    return new Set(chat.roleIds
      .map(roleId => store.rolesById[roleId])
      .filter(role => role?.templateId === template.id)
      .map(role => roleModelKey(role, store)))
  }

  function usedNameSites(name: string): Set<string> {
    const chat = deps.getCurrentChat()
    if (!chat) return new Set()
    const store = deps.getStore()
    return new Set(chat.roleIds
      .map(roleId => store.rolesById[roleId])
      .filter(role => role?.name.trim().toLowerCase() === name.trim().toLowerCase())
      .map(role => roleModelKey(role, store)))
  }

  function readTemplateDraft(): TemplateDraft {
    return {
      name: deps.templateNameEl.value.trim(),
      description: deps.templateDescriptionEl.value.trim(),
      systemPrompt: deps.templatePromptEl.value.trim(),
      defaultModelSource: readTemplateModelSource(),
      defaultChatSite: deps.templateSiteExternalEl.checked ? undefined : readTemplateChatSite(),
      defaultExternalModelId: deps.templateSiteExternalEl.checked ? deps.templateExternalModelSelectEl.value : undefined,
      chatGptGptsUrl: deps.templateSiteChatGptEl.checked ? deps.templateChatGptGptsUrlEl.value.trim() : undefined,
      grokProjectUrl: deps.templateSiteGrokEl.checked ? deps.templateGrokProjectUrlEl.value.trim() : undefined,
    }
  }

  function validatePersonDraft(draft: Pick<TemplateDraft, 'name' | 'description' | 'systemPrompt'>): string | undefined {
    if (!draft.name) return '人员名称不能为空'
    if (Array.from(draft.name).length > ROLE_NAME_MAX_CHARACTERS) return `人员名称最多 ${ROLE_NAME_MAX_CHARACTERS} 个字`
    return undefined
  }

  async function generateTemplatePersona(): Promise<void> {
    const description = deps.templateAiDescriptionEl.value.trim()
    if (!description) {
      deps.showError(ui('请先描述想要生成的人设'))
      return
    }

    deps.generateTemplatePersonaEl.disabled = true
    deps.generateTemplatePersonaEl.textContent = ui('生成中')
    deps.templatePersonaGenerationStatusEl.textContent = ui('生成中...')
    try {
      const persona = await deps.generatePersona(description)
      deps.templateNameEl.value = persona.name
      deps.templateDescriptionEl.value = persona.description
      deps.templatePromptEl.value = persona.systemPrompt
      deps.templatePersonaGenerationStatusEl.textContent = ui('已生成，可继续修改后保存')
    } catch (error) {
      deps.templatePersonaGenerationStatusEl.textContent = ''
      throw error
    } finally {
      deps.generateTemplatePersonaEl.disabled = false
      deps.generateTemplatePersonaEl.textContent = ui('AI 生成')
    }
  }

  function selectedAddPersonItems(): Record<string, unknown>[] {
    const items = addPersonItems()
    const itemKeys = new Set(items.map(item => item.key))
    const checkedKeys = new Set(deps.state.addPersonSelectedKeys)
    for (const input of deps.addLibraryPeopleListEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')) {
      if (itemKeys.has(input.value)) checkedKeys.add(input.value)
    }
    return items.filter(item => checkedKeys.has(item.key)).flatMap(item => item.chatSites.map(chatSite => {
      const modelPatch = payloadForModelKey(chatSite)
      if (item.source === 'library') return { source: 'library', roleTemplateId: item.roleTemplateId, ...modelPatch }
      return {
        source: 'temporary',
        name: item.name,
        description: item.description,
        systemPrompt: item.systemPrompt,
        ...modelPatch,
      }
    }))
  }

  function readTemplateChatSite(): ChatSite {
    if (deps.templateSiteChatGptEl.checked) return 'chatgpt'
    if (deps.templateSiteClaudeEl.checked) return 'claude'
    if (deps.templateSiteDeepSeekEl.checked) return 'deepseek'
    if (deps.templateSiteGrokEl.checked) return 'grok'
    if (deps.templateSiteQwenEl.checked) return 'qwen'
    return 'gemini'
  }

  function readTemplateModelSource(): RoleModelSource {
    return deps.templateSiteExternalEl.checked ? 'external' : 'site'
  }

  function syncTemplateModelFields(): void {
    const chatGptVisible = deps.templateSiteChatGptEl.checked
    deps.templateChatGptGptsFieldEl.hidden = !chatGptVisible
    deps.templateChatGptGptsFieldEl.style.display = chatGptVisible ? '' : 'none'
    if (!chatGptVisible) deps.templateChatGptGptsUrlEl.value = ''
    const grokVisible = deps.templateSiteGrokEl.checked
    deps.templateGrokProjectFieldEl.hidden = !grokVisible
    deps.templateGrokProjectFieldEl.style.display = grokVisible ? '' : 'none'
    if (!grokVisible) deps.templateGrokProjectUrlEl.value = ''
    const externalVisible = deps.templateSiteExternalEl.checked
    deps.templateExternalModelFieldEl.hidden = !externalVisible
    deps.templateExternalModelFieldEl.style.display = externalVisible ? '' : 'none'
  }

  function templateSiteInputs(): HTMLInputElement[] {
    return [
      deps.templateSiteGeminiEl,
      deps.templateSiteChatGptEl,
      deps.templateSiteClaudeEl,
      deps.templateSiteDeepSeekEl,
      deps.templateSiteGrokEl,
      deps.templateSiteQwenEl,
      deps.templateSiteExternalEl,
    ]
  }

  function renderExternalModelSelect(): void {
    const models = externalModels(deps.getStore())
    deps.templateExternalModelSelectEl.replaceChildren()
    if (models.length === 0) {
      deps.templateExternalModelSelectEl.append(new Option(ui('先在设置中添加外部模型'), ''))
      deps.templateSiteExternalEl.disabled = true
      return
    }
    deps.templateSiteExternalEl.disabled = false
    for (const model of models) deps.templateExternalModelSelectEl.append(new Option(`${model.name} · ${model.modelName}`, model.id))
  }

  function firstExternalModelId(): string | undefined {
    return externalModels(deps.getStore())[0]?.id
  }

  function defaultModelKeyForTemplate(template: RoleTemplate, store: OpenTeamStore): string {
    if (template.defaultModelSource === 'external' && template.defaultExternalModelId && store.settings.externalModelsById[template.defaultExternalModelId]) {
      return modelKeyForExternal(template.defaultExternalModelId)
    }
    return modelKeyForSite(visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite))
  }

  function roleModelKey(role: { modelSource?: RoleModelSource; externalModelId?: string; chatSite?: ChatSite }, store: OpenTeamStore): string {
    if (role.modelSource === 'external' && role.externalModelId) return modelKeyForExternal(role.externalModelId)
    return modelKeyForSite(visibleChatSite(role.chatSite ?? store.settings.defaultChatSite))
  }

  function payloadForModelKey(key: string): Record<string, unknown> {
    const externalModelId = externalModelIdFromKey(key)
    if (externalModelId) return { modelSource: 'external', externalModelId }
    return { modelSource: 'site', chatSite: chatSiteFromModelKey(key) }
  }

  function selectableModels(store: OpenTeamStore): Array<{ key: string; label: string; className: string }> {
    return [
      ...VISIBLE_CHAT_SITES.map(site => ({ key: modelKeyForSite(site), label: siteLabel(site), className: `site-pill-${site}` })),
      ...externalModels(store).map(model => ({ key: modelKeyForExternal(model.id), label: `API · ${model.name}`, className: 'site-pill-external' })),
    ]
  }

  async function addPeopleToCurrentChat(items: Record<string, unknown>[]): Promise<void> {
    const chat = deps.getCurrentChat()
    if (!chat) return
    if (items.length === 0) throw new Error('请选择或填写要添加的人员')
    await deps.runCommand('GROUP_ROLES_CREATE_BATCH', { chatId: chat.id, items })
  }

  function deleteTemplate(template: RoleTemplate): void {
    if (isTemplateUsed(template.id)) return
    if (!window.confirm(`确定删除「${template.name}」吗？删除后这个人员会从人员库移除。`)) return
    if (deps.state.selectedTemplateId === template.id) closeTemplateEditor()
    deps.runCommand('ROLE_TEMPLATE_DELETE', { templateId: template.id }).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function isTemplateUsed(templateId: string): boolean {
    return Object.values(deps.getStore().rolesById).some(role => role.templateId === templateId)
  }

  function displayRoleTemplate(template: RoleTemplate): RoleTemplate {
    return localizeRoleTemplate(template, language())
  }

  function displayAddPersonItem(item: AddPersonItem): AddPersonItem {
    if (item.source === 'temporary') return item
    const localized = localizeRoleTemplate({
      id: item.roleTemplateId,
      type: item.type,
      name: item.name,
      category: item.category,
      sourceTemplateId: item.sourceTemplateId,
      sourceTemplateName: item.sourceTemplateName,
      description: item.description,
      systemPrompt: item.systemPrompt,
      createdAt: 0,
      updatedAt: 0,
    }, language())
    return {
      ...item,
      name: localized.name,
      category: localized.category,
      sourceTemplateName: localized.sourceTemplateName,
      description: localized.description,
      systemPrompt: localized.systemPrompt,
    }
  }

  function language(): TeamLanguage {
    return normalizeLanguage(deps.getStore().settings.language)
  }

  function ui(source: string): string {
    return translateUi(source, language())
  }

  return { closePeopleModals, openAddPersonDialog, registerPeopleLibraryEvents, renderAddPersonDialog, renderTemplates }
}

function siteLabel(site: ChatSite | undefined): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  if (site === 'qwen') return 'Qwen'
  return 'Gemini'
}

function templateModelLabel(template: RoleTemplate, store: OpenTeamStore): string {
  if (template.defaultModelSource === 'external' && template.defaultExternalModelId) {
    return externalModelLabel(store.settings.externalModelsById[template.defaultExternalModelId])
  }
  return siteLabel(visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite))
}

function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model ? `API · ${model.name}` : 'API · 未配置'
}

function templateTypeLabel(type: RoleTemplate['type'], language: TeamLanguage): string {
  return translateUi(type === 'builtin' ? '内置人员' : '自定义人员', language)
}

function templateMetaText(template: RoleTemplate, language: TeamLanguage): string {
  return [
    templateTypeLabel(template.type, language),
    localizeCategory(template.category, language),
    template.sourceTemplateName,
  ].filter(Boolean).join(' · ')
}

function addPersonMetaText(item: AddPersonItem, language: TeamLanguage): string {
  return [
    templateTypeLabel(item.type, language),
    localizeCategory(item.category, language),
    item.sourceTemplateName,
  ].filter(Boolean).join(' · ')
}

function categoryOptionsForTemplates(templates: RoleTemplate[]): string[] {
  return categoryOptions(templates.map(template => template.category))
}

function categoryOptionsForItems(items: AddPersonItem[]): string[] {
  return categoryOptions(items.map(item => item.category))
}

function categoryOptions(categories: Array<string | undefined>): string[] {
  const uniqueCategories = categories
    .map(category => category?.trim())
    .filter((category): category is string => Boolean(category))
  return [TEMPLATE_CATEGORY_ALL, ...Array.from(new Set(uniqueCategories))]
}

function renderCategoryFilter(element: HTMLElement, categories: string[], activeCategory: string, onSelect: (category: string) => void, language: TeamLanguage = 'zh-CN'): void {
  element.replaceChildren()
  element.className = 'template-category-filter'
  for (const category of categories) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `template-category-chip${category === activeCategory ? ' active' : ''}`
    button.dataset.category = category
    button.textContent = localizeCategory(category, language) ?? category
    button.addEventListener('click', () => onSelect(category))
    element.append(button)
  }
}

function visibleChatSite(site: ChatSite | undefined): ChatSite {
  return site && VISIBLE_CHAT_SITES.includes(site as typeof VISIBLE_CHAT_SITES[number]) ? site : 'gemini'
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

function externalModelIdFromKey(key: string): string | undefined {
  return key.startsWith('external:') ? key.slice('external:'.length) || undefined : undefined
}

function chatSiteFromModelKey(key: string): ChatSite {
  const value = key.startsWith('site:') ? key.slice('site:'.length) : key
  return visibleChatSite(value as ChatSite)
}

function personaGenerationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Unknown OpenTeam message') return 'AI 生成人设需要重新加载 OpenTeam 扩展后再使用'
  return message
}
