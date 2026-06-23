import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readTeamHtml(): string {
  return readFileSync(resolve(process.cwd(), 'public/team.html'), 'utf8')
}

function readTeamCss(): string {
  return readFileSync(resolve(process.cwd(), 'public/team.css'), 'utf8')
}

function readTeamDocument(): string {
  return `${readTeamHtml()}\n${readTeamCss()}`
}

const REMOVED_SITE_IDS = ['ki' + 'mi']
const removedSiteLabel = (_siteId: string): string => 'K' + 'imi'

describe('team.html chat creation UI', () => {
  it('starts unlocked without a local invite-code activation gate', () => {
    const html = readTeamDocument()

    expect(html).toContain('<body>')
    expect(html).toContain('<div id="app" class="app-shell">')
    expect(html).not.toContain('access-locked')
    expect(html).not.toContain('invite-gate')
    expect(html).not.toContain('invite-code')
    expect(html).not.toMatch(/\binvite[-\w]*/i)
  })

  it('loads team styles from an external stylesheet', () => {
    const html = readTeamHtml()
    const css = readTeamCss()

    expect(html).toContain('<link rel="stylesheet" href="team.css" />')
    expect(html).not.toContain('<style>')
    expect(html).not.toContain('</style>')
    expect(css).toContain(':root')
    expect(css).toContain('body {')
  })

  it('includes a two-option theme switch and both page theme style sets', () => {
    const html = readTeamDocument()

    expect(html).toContain('id="theme-switch"')
    expect(html).toContain('id="theme-light"')
    expect(html).toContain('id="theme-dark"')
    expect(html).toContain('浅色')
    expect(html).toContain('深色')
    expect(html).toContain('data-theme="dark"')
    expect(html).toMatch(/:root\[data-theme="light"\]\s*{/)
    expect(html).toMatch(/:root\[data-theme="dark"\]\s*{/)
    expect(html).toMatch(/\.theme-switch\s*{[^}]*position:\s*relative;/s)
    expect(html).toMatch(/\.theme-option\[aria-pressed="true"\]\s*{[^}]*background:/s)
  })

  it('light theme restyles dense dark surfaces instead of leaving dark component islands', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/:root\[data-theme="light"\][\s\S]*--orchestration-node-bg:/)
    expect(html).toMatch(/:root\[data-theme="light"\] \.chat-avatar\s*{[^}]*border:\s*1px solid rgba\(17,\s*24,\s*39,\s*0\.1\);[^}]*background:\s*#6b7280;[^}]*color:\s*#ffffff;[^}]*box-shadow:\s*none;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.chat-avatar\.role-tone-0\s*{[^}]*background:\s*#42b883;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-task-strip\s*{[^}]*background:/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-person\s*{[^}]*background:/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-template-card\s*{[^}]*background:/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.all-notes-editor-header h3\s*{[^}]*color:\s*var\(--text\);/s)
  })

  it('uses a WeChat-like light gray hover state for the light chat list', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/:root\[data-theme="light"\] \.chat-item:hover,\s*:root\[data-theme="light"\] \.chat-item\.active\s*{[^}]*background:\s*#f2f3f5;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.chat-item\.active\s*{[^}]*border-color:\s*rgba\(17,\s*24,\s*39,\s*0\.08\);[^}]*box-shadow:\s*none;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.chat-name:hover\s*{[^}]*color:\s*var\(--text\);/s)
  })

  it('keeps light theme page and modal backgrounds pure white instead of blue-gray washes', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/:root\[data-theme="light"\]\s*{[^}]*--bg:\s*#ffffff;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] body\s*{[^}]*background:\s*#ffffff;/s)
    expect(html).not.toMatch(/:root\[data-theme="light"\] body\s*{[^}]*gradient/s)

    for (const selector of [
      '.app-shell',
      '.rail',
      '.sidebar',
      '.workspace',
      '.chat-header',
      '.all-notes-list',
      '#iframe-host',
      '.orchestration-workspace',
      '.orchestration-task-strip',
      '.orchestration-person',
      '.orchestration-template-card',
    ]) {
      expect(html).toMatch(new RegExp(`:root\\[data-theme="light"\\] ${selector.replace('.', '\\.')}\\s*{[^}]*background:\\s*#ffffff;`, 's'))
    }
  })

  it('keeps light theme modal backdrops translucent and blurred instead of white-screening the page', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/\.modal-backdrop\s*{[^}]*backdrop-filter:\s*blur\(10px\);/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.modal-backdrop\s*{[^}]*background:\s*rgba\(17,\s*24,\s*39,\s*0\.24\);/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.modal-backdrop-secondary\s*{[^}]*background:\s*rgba\(17,\s*24,\s*39,\s*0\.18\);/s)
    expect(html).not.toMatch(/:root\[data-theme="light"\] \.modal-backdrop\s*{[^}]*background:\s*#ffffff;/s)
  })

  it('keeps light theme automatic orchestration chat messages readable', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-auto-message-content\s*{[^}]*border-color:\s*rgba\(17,\s*24,\s*39,\s*0\.12\);[^}]*background:\s*#ffffff;[^}]*color:\s*#374151;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-auto-message\.user \.orchestration-auto-message-content\s*{[^}]*background:\s*#b0f0a7;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.orchestration-auto-input-shell\s*{[^}]*background:\s*#ffffff;/s)
  })

  it('offers an explicit chat mode choice before creating a chat from the plus button', () => {
    const html = readTeamDocument()
    const modeOptions = html.match(/<div class="mode-options">[\s\S]*?<\/div>\s*<\/div>\s*<div class="two-col">/)?.[0] ?? ''

    expect(html).toContain('id="chat-create-popover"')
    expect(html).toContain('id="new-chat-mode-independent"')
    expect(html).toContain('id="new-chat-mode-collaborative"')
    expect(html).toContain('协作群聊')
    expect(modeOptions.indexOf('new-chat-mode-collaborative')).toBeLessThan(modeOptions.indexOf('new-chat-mode-independent'))
    expect(modeOptions).toMatch(/id="new-chat-mode-collaborative"[^>]*checked/)
    expect(modeOptions).not.toMatch(/id="new-chat-mode-independent"[^>]*checked/)
  })

  it('offers group template creation below the normal new chat form', () => {
    const html = readTeamDocument()
    const createForm = html.match(/<form id="create-chat-form"[\s\S]*?<\/form>/)?.[0] ?? ''

    expect(createForm).toContain('id="open-group-template-create"')
    expect(createForm.indexOf('class="two-col"')).toBeLessThan(createForm.indexOf('id="open-group-template-create"'))
    expect(html).toContain('id="group-template-modal"')
    expect(html).toContain('id="group-template-list"')
    expect(html).toContain('id="confirm-group-template-create"')
    expect(html).toContain('从模板中创建')
    expect(html).toMatch(/\.group-template-option\s*{/s)
    expect(html).toMatch(/\.group-template-option\.active\s*{/s)
  })

  it('includes the people-library workflows, right drawer, iframe host, and minimized launcher', () => {
    const html = readTeamDocument()

    expect(html).toContain('id="settings-button"')
    expect(html).toContain('id="settings-menu"')
    expect(html).toContain('id="agent-control-toggle"')
    expect(html).toContain('本机智能体控制')
    expect(html).toContain('id="open-people-library"')
    expect(html).not.toContain('id="default-site-gemini"')
    expect(html).not.toContain('id="default-site-chatgpt"')
    expect(html).not.toContain('id="default-site-claude"')
    expect(html).not.toContain('id="default-site-deepseek"')
    for (const site of REMOVED_SITE_IDS) expect(html).not.toContain(`id="default-site-${site}"`)
    expect(html).toContain('id="people-library-modal"')
    expect(html).toContain('id="people-library-list"')
    expect(html).toContain('id="people-library-search"')
    expect(html).toContain('id="people-library-category-filter"')
    expect(html).toContain('id="people-library-tab-builtin"')
    expect(html).toContain('id="people-library-tab-custom"')
    expect(html).toContain('id="builtin-template-detail-modal"')
    expect(html).toContain('id="builtin-template-detail-prompt"')
    expect(html).toContain('id="template-site-gemini"')
    expect(html).toContain('id="template-site-chatgpt"')
    expect(html).toContain('id="template-site-claude"')
    expect(html).toContain('id="template-site-deepseek"')
    expect(html).toContain('id="template-site-grok"')
    expect(html).toContain('id="template-site-qwen"')
    expect(html).not.toMatch(/id="template-site-gemini"[^>]*checked/)
    expect(html).toMatch(/id="template-site-deepseek"[^>]*checked/)
    for (const site of REMOVED_SITE_IDS) {
      expect(html).not.toContain(`id="template-site-${site}"`)
      expect(html).not.toContain(`for="template-site-${site}"`)
    }
    expect(html).toMatch(/\.site-segment\[hidden\]\s*{[^}]*display:\s*none;/s)
    expect(html).toContain('id="add-person-modal"')
    expect(html).toContain('id="add-person-category-filter"')
    expect(html).toContain('id="open-temporary-person"')
    expect(html).toContain('id="temporary-person-modal"')
    expect(html).toContain('id="add-library-people-form"')
    expect(html).toContain('id="add-temporary-person-form"')
    expect(html).toContain('id="toggle-people-drawer"')
    expect(html).toContain('class="panel role-panel"')
    expect(html).toContain('id="close-people-drawer"')
    expect(html).toContain('id="window-launcher"')
    expect(html).toContain('id="iframe-host"')
    expect(html).toContain('id="toggle-notes-panel"')
    expect(html).toContain('id="open-all-notes"')
    expect(html).toContain('id="all-notes-modal"')
    expect(html).toContain('id="all-notes-list"')
    expect(html).toContain('id="all-notes-editor"')
    expect(html).toContain('id="all-note-bold"')
    expect(html).toContain('id="notes-panel"')
    expect(html).toContain('id="notes-drag-handle"')
    expect(html).toContain('id="notes-editor"')
    expect(html).toContain('id="global-note-tab"')
    expect(html).toContain('id="chat-note-tab"')
    expect(html).toContain('id="template-chatgpt-gpts-field"')
    expect(html).toContain('id="template-chatgpt-gpts-url"')
    expect(html).toContain('id="template-grok-project-field"')
    expect(html).toContain('id="template-grok-project-url"')
    expect(html).toMatch(/\.field\[hidden\]\s*{[^}]*display:\s*none;/s)
    expect(html).toMatch(/\.template-prompt-preview\s*{[^}]*white-space:\s*pre-wrap;/s)
    expect(html).toMatch(/\.template-category-filter\s*{[^}]*flex-wrap:\s*wrap;/s)
    expect(html).toMatch(/\.template-category-chip\.active\s*{[^}]*background:/s)
    expect(html).toContain('人员库')
    expect(html).toContain('人设')
    expect(html).toContain('站点')
    expect(html).not.toContain('System Prompt')
  })

  it('opens notes as a draggable floating window instead of a right drawer', () => {
    const html = readTeamDocument()
    const notesPanelRule = html.match(/(?:^|\n)\.notes-panel\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const notesOpenRule = html.match(/(?:^|\n)\.notes-panel\.open\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(notesPanelRule).toContain('position: fixed;')
    expect(notesPanelRule).toContain('border-radius: 14px;')
    expect(notesPanelRule).not.toContain('translateX(100%)')
    expect(notesOpenRule).toContain('pointer-events: auto;')
    expect(html).toMatch(/\.notes-panel-header\s*{[^}]*cursor:\s*grab;/s)
  })

  it('uses the left rail note icon for all notes instead of inactive placeholder icons', () => {
    const html = readTeamDocument()

    expect(html).toContain('aria-label="查看全部笔记"')
    expect(html).toContain('id="open-all-notes"')
    expect(html).toContain('data-tooltip="全部笔记"')
    expect(html).not.toContain('aria-label="消息"')
    expect(html).not.toContain('aria-label="实验"')
    expect(html).not.toContain('>✎</button>')
    expect(html).toMatch(/\.all-notes-modal\s*{[^}]*width:\s*min\(980px,\s*calc\(100vw - 48px\)\);/s)
    expect(html).toMatch(/\.all-notes-workspace\s*{[^}]*grid-template-columns:\s*240px minmax\(0,\s*1fr\);/s)
    expect(html).toMatch(/\.all-note-target\.deleted-chat\s*{[^}]*border-color:\s*rgba\(248,\s*184,\s*78,\s*0\.22\);/s)
  })

  it('pins every modal close icon to the top-right corner of the whole dialog', () => {
    const html = readTeamDocument()
    const closeButtonIds = [
      'close-all-notes',
      'close-people-library',
      'close-external-models',
      'close-person-template',
      'close-builtin-template-detail',
      'close-add-person',
      'close-temporary-person',
      'close-orchestration',
    ]

    for (const id of closeButtonIds) {
      expect(html).toMatch(new RegExp(`<button id="${id}" class="icon-btn modal-close"`))
    }
    expect(html).toMatch(/\.modal\s*{[^}]*position:\s*relative;/s)
    expect(html).toMatch(/\.modal-close\s*{[^}]*position:\s*absolute;[^}]*top:\s*14px;[^}]*right:\s*14px;/s)
  })

  it('adds an orchestration modal and chat-header entry before members without exposing stage wording', () => {
    const html = readTeamDocument()
    const chatRow = html.match(/<header class="chat-header">(?<body>[\s\S]*?)<\/header>/)?.groups?.body ?? ''
    const railActions = html.match(/<div class="rail-actions">(?<body>[\s\S]*?)<\/div>/)?.groups?.body ?? ''

    expect(html).toContain('id="open-orchestration"')
    expect(chatRow.indexOf('id="open-orchestration"')).toBeGreaterThanOrEqual(0)
    expect(chatRow.indexOf('id="open-orchestration"')).toBeLessThan(chatRow.indexOf('id="toggle-people-drawer"'))
    expect(railActions).not.toContain('id="open-orchestration"')
    expect(html).toContain('id="orchestration-modal"')
    expect(html).toContain('id="orchestration-task"')
    expect(html).toContain('id="auto-orchestration"')
    expect(html).toContain('id="orchestration-people-list"')
    expect(html).toContain('id="arrange-orchestration"')
    expect(html).toContain('id="orchestration-stage-canvas"')
    expect(html).toContain('id="orchestration-stage-settings"')
    expect(html).toContain('id="orchestration-review-settings"')
    expect(html).toContain('id="orchestration-max-rounds" type="number" min="1" max="200" value="50"')
    expect(html).toContain('画布节点按连线顺序执行')
    expect(html).toContain('拖到画布创建节点')
    expect(html).toContain('节点设置')
    expect(html).toContain('最大节点执行数')
    expect(html).toContain('执行节点和审核节点都会计数')
    expect(html).not.toContain('仅运行一轮')
    expect(html).not.toContain('添加为阶段')
    expect(html).not.toContain('阶段设置')
    expect(html).not.toContain('审核阶段')
    expect(html).toContain('不需要 @ 人员')
    expect(html).toContain('class="orchestration-task-strip"')
    expect(html).toContain('class="orchestration-task-input-row"')
    expect(html).toContain('class="orchestration-footer"')
    expect(html).toMatch(/\.orchestration-modal\s*{[^}]*height:\s*min\(760px,\s*calc\(100vh - 42px\)\);[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/\.orchestration-layout\s*{[^}]*grid-template-columns:\s*220px minmax\(450px, 1fr\) 300px;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/\.orchestration-people-list\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;[^}]*flex:\s*1 1 auto;/s)
    expect(html).toMatch(/\.orchestration-stage-canvas\s*{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s)
    expect(html).toMatch(/\.orchestration-footer\s*{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s)
    expect(html).toMatch(/\.orchestration-arrange\s*{[^}]*position:\s*absolute;[^}]*top:\s*12px;[^}]*right:\s*12px;/s)
    expect(html).toMatch(/\.orchestration-stage-canvas \.x6-edge \.connection-wrap,[\s\S]*?\.orchestration-stage-canvas \.x6-edge path\[stroke="transparent"\]\s*{[^}]*stroke:\s*transparent;[^}]*stroke-width:\s*14px;/s)
    expect(html).toMatch(/\.orchestration-stage-canvas \.x6-edge \.connection\s*{[^}]*filter:/s)
    expect(html).toMatch(/\.orchestration-stage-canvas \.x6-edge \.vertices \.vertex\s*{[^}]*stroke:\s*#7de6ea;/s)
    expect(html).not.toMatch(/\.orchestration-stage-canvas \.x6-edge path\s*{[^}]*stroke:\s*#7de6ea;/s)
    expect(html).not.toContain('.x6-edge path:nth-child(2)')
    expect(html).toMatch(/\.orchestration-settings\s*{[^}]*overflow:\s*auto;/s)
    expect(html).toMatch(/\.orchestration-json-preview pre\s*{[^}]*max-height:\s*130px;/s)
    expect(html).toMatch(/\.orchestration-status-floating\s*{[^}]*position:\s*fixed;[^}]*box-sizing:\s*border-box;/s)
    expect(html).toMatch(/\.orchestration-status-collapsed\s*{[^}]*width:\s*46px;[^}]*height:\s*46px;[^}]*border-radius:\s*999px;/s)
    expect(html).toMatch(/\.orchestration-status-window-actions\s*{[^}]*flex-wrap:\s*wrap;/s)
    expect(html).toMatch(/\.orchestration-status-window-actions \.btn\s*{[^}]*min-height:\s*26px;[^}]*font-size:\s*12px;/s)
    expect(html).toMatch(/\.orchestration-mini-flow\s*{[^}]*width:\s*100%;/s)
    expect(html).toMatch(/\.message-row\.user \.orchestration-message-label\s*{[^}]*color:/s)
  })

  it('promotes people library and external models from settings into the left rail', () => {
    const html = readTeamDocument()
    const railActions = html.match(/<div class="rail-actions">(?<body>[\s\S]*?)<\/div>/)?.groups?.body ?? ''
    const settingsMenu = html.match(/<div id="settings-menu" class="settings-menu" hidden>(?<body>[\s\S]*?)<\/div>/)?.groups?.body ?? ''

    expect(railActions).toContain('id="open-people-library"')
    expect(railActions).toContain('aria-label="群聊"')
    expect(railActions).toContain('data-tooltip="群聊"')
    expect(railActions).toContain('aria-label="打开人员库"')
    expect(railActions).toContain('data-tooltip="人员库"')
    expect(railActions).toContain('id="open-external-models"')
    expect(railActions).toContain('aria-label="添加大模型"')
    expect(railActions).toContain('data-tooltip="添加大模型"')
    expect(railActions).toContain('<svg aria-hidden="true"')
    expect(railActions).not.toContain('>⌁</button>')
    expect(railActions).not.toContain('>人</button>')
    expect(railActions).not.toContain('>模</button>')
    expect(settingsMenu).not.toContain('id="open-people-library"')
    expect(settingsMenu).not.toContain('id="open-external-models"')
    expect(html).toMatch(/\.rail\s*{[^}]*grid-template-rows:\s*74px 1fr auto;/s)
    expect(html).toMatch(/\.rail-actions\s*{[^}]*padding-top:\s*0;/s)
    expect(html).toMatch(/\.rail-btn\[data-tooltip\]::after\s*{[^}]*content:\s*attr\(data-tooltip\);/s)
    expect(html).toMatch(/\.rail-btn\[data-tooltip\]:hover::after,\s*\.rail-btn\[data-tooltip\]:focus-visible::after\s*{[^}]*opacity:\s*1;/s)
  })

  it('styles window controls as visible mac-style traffic lights', () => {
    const html = readTeamDocument()
    const toolbarRule = html.match(/(?:^|\n)\.floating-toolbar\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const fullscreenToolbarRule = html.match(/(?:^|\n)\.app-shell\.fullscreen \.floating-toolbar\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(html).toContain('class="icon-btn window-dot window-dot-close"')
    expect(html).toContain('class="icon-btn window-dot window-dot-minimize"')
    expect(html).toContain('class="icon-btn window-dot window-dot-fullscreen"')
    expect(toolbarRule).toContain('left: auto;')
    expect(toolbarRule).toContain('right: 18px;')
    expect(toolbarRule).toContain('top: 6px;')
    expect(toolbarRule).toContain('height: 11px;')
    expect(toolbarRule).toContain('flex-direction: row-reverse;')
    expect(toolbarRule).toContain('z-index: 12;')
    expect(fullscreenToolbarRule).toContain('left: auto;')
    expect(fullscreenToolbarRule).toContain('right: 18px;')
    expect(fullscreenToolbarRule).toContain('top: 6px;')
    expect(html).toMatch(/\.floating-toolbar \.icon-btn\s*{[^}]*width:\s*11px;[^}]*height:\s*11px;/s)
    expect(html).toMatch(/\.floating-toolbar \.icon-btn\.window-dot-close\s*{[^}]*background:\s*#ff5f57;/s)
    expect(html).toMatch(/\.floating-toolbar \.icon-btn\.window-dot-minimize\s*{[^}]*background:\s*#febc2e;/s)
    expect(html).toMatch(/\.floating-toolbar \.icon-btn\.window-dot-fullscreen\s*{[^}]*background:\s*#28c840;/s)
    expect(html).toMatch(/\.floating-toolbar \.icon-btn\.window-dot:hover\s*{[^}]*border-color:\s*rgba\(0,\s*0,\s*0,\s*0\.24\);[^}]*filter:\s*brightness\(1\.04\);/s)
  })

  it('uses the top-right close affordance to shrink the floating window', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/floatingWindow.ts'), 'utf8')

    expect(html).toContain('id="close-window"')
    expect(html).toMatch(/id="close-window"[^>]*aria-label="缩小窗口"/)
    expect(source).toContain("closeWindowEl?.addEventListener('click', () => setWindowMinimized(true))")
  })

  it('keeps the orchestration entry visually hidden when the hidden attribute is set', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/#open-orchestration\[hidden\]\s*{[^}]*display:\s*none;/s)
  })

  it('uses template default sites for library people and the add-person picker for temporary people', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')

    expect(source).toContain('function addPersonSiteControl(itemKey: string, chatSites: string[], disabledSites: Set<string>): HTMLElement')
    expect(source).toContain('function selectedAddPersonSites(itemKey: string, fallbackSite: string, disabledSites = new Set<string>()): string[]')
    expect(source).toContain("item.chatSites.map(chatSite =>")
    expect(source).toContain("if (item.source === 'library') return { source: 'library', roleTemplateId: item.roleTemplateId, ...modelPatch }")
    expect(source).toContain("source: 'temporary'")
    expect(source).toContain("if (deps.templateSiteClaudeEl.checked) return 'claude'")
    expect(source).toContain("if (deps.templateSiteDeepSeekEl.checked) return 'deepseek'")
    expect(source).toContain("if (deps.templateSiteGrokEl.checked) return 'grok'")
    expect(source).toContain("const VISIBLE_CHAT_SITES = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok', 'qwen'] as const")
    for (const site of REMOVED_SITE_IDS) expect(source).not.toContain(`return '${site}'`)
    expect(source).not.toContain('templateSite' + 'K' + 'imiEl')
    expect(source).toContain('deps.templateSiteQwenEl')
  })

  it('stores a default target site on people-library entries instead of the settings menu', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')
    const domRefsSource = readFileSync(resolve(process.cwd(), 'src/teamPage/domRefs.ts'), 'utf8')

    expect(source).not.toContain("'#default-site-gemini'")
    expect(source).not.toContain("'#default-site-chatgpt'")
    expect(source).not.toContain("'#default-site-claude'")
    expect(source).not.toContain("'#default-site-deepseek'")
    for (const site of REMOVED_SITE_IDS) expect(source).not.toContain(`'#default-site-${site}'`)
    expect(domRefsSource).toContain('templateSiteGeminiEl')
    expect(source).toContain('function readTemplateChatSite(): ChatSite')
    expect(source).toContain('defaultChatSite: deps.templateSiteExternalEl.checked ? undefined : readTemplateChatSite()')
    expect(source).toContain('defaultExternalModelId: deps.templateSiteExternalEl.checked ? deps.templateExternalModelSelectEl.value : undefined')
    expect(source).toContain('template.defaultChatSite ?? store.settings.defaultChatSite')
    expect(source).toContain('chatGptGptsUrl: deps.templateSiteChatGptEl.checked ? deps.templateChatGptGptsUrlEl.value.trim() : undefined')
    expect(source).toContain('grokProjectUrl: deps.templateSiteGrokEl.checked ? deps.templateGrokProjectUrlEl.value.trim() : undefined')
    expect(source).toContain('function syncTemplateModelFields(): void')
    expect(html).not.toContain('默认站点：Gemini')
    expect(html).not.toContain('默认站点：ChatGPT')
    expect(html).not.toContain('默认站点：Claude')
    expect(html).not.toContain('默认站点：DeepSeek')
    for (const site of REMOVED_SITE_IDS) expect(html).not.toContain(`默认站点：${removedSiteLabel(site)}`)
  })

  it('keeps the people-library modal as a list and opens a separate editor for creating or editing people', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')
    const domRefsSource = readFileSync(resolve(process.cwd(), 'src/teamPage/domRefs.ts'), 'utf8')
    const peopleLibraryModal = html.match(/<div id="people-library-modal"[\s\S]*?<div id="person-template-modal"/)?.[0] ?? ''
    const personTemplateModal = html.match(/<div id="person-template-modal"[\s\S]*?<div id="add-person-modal"/)?.[0] ?? ''

    expect(html).toContain('id="new-template"')
    expect(html).toContain('id="person-template-modal"')
    expect(html).toContain('id="close-person-template"')
    expect(personTemplateModal).toContain('id="template-name" type="text" maxlength="50"')
    expect(peopleLibraryModal).not.toContain('id="people-library-form"')
    expect(peopleLibraryModal).not.toContain('id="template-name"')
    expect(personTemplateModal).not.toContain('id="delete-template"')
    expect(source).toContain('function openTemplateEditor(templateId?: string): void')
    expect(source).toContain("edit.className = 'btn btn-ghost template-edit'")
    expect(source).toContain("edit.textContent = ui('编辑')")
    expect(source).toContain("remove.className = 'btn btn-danger template-delete'")
    expect(source).toContain("remove.textContent = ui('删除')")
    expect(source).toContain('window.confirm(`确定删除「${template.name}」吗？删除后这个人员会从人员库移除。`)')
    expect(source).toContain('if (!isTemplateUsed(template.id)) actions.append(remove)')
    expect(domRefsSource).toContain("'#new-template'")
    expect(domRefsSource).toContain("'#close-person-template'")
  })

  it('keeps long people-library lists scrolling inside the left list pane', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/#people-library-modal \.modal\s*{[^}]*display:\s*grid;/s)
    expect(html).toMatch(/#people-library-modal \.modal\s*{[^}]*height:\s*min\(760px,\s*calc\(100vh - 48px\)\);/s)
    expect(html).toMatch(/#people-library-modal \.modal\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s)
    expect(html).toMatch(/#people-library-modal \.modal\s*{[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/\.people-library-content\s*{[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/\.people-library-pane\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;/s)
    expect(html).toMatch(/\.people-library-pane\s*{[^}]*min-height:\s*0;/s)
    expect(html).toMatch(/#people-library-list\s*{[^}]*overflow:\s*auto;/s)
    expect(html).toMatch(/#people-library-list\s*{[^}]*min-height:\s*0;/s)
    expect(html).toMatch(/#people-library-list\s*{[^}]*max-height:\s*none;/s)
  })

  it('shows role sites as compact pills with a menu instead of always-visible switch buttons', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/rolePanelView.ts'), 'utf8')

    expect(source).toContain("sitePill.className = `site-pill ${model.className}`")
    expect(source).toContain("menu.className = 'role-site-menu'")
    expect(source).toContain("option.className = `role-site-option${active ? ' active' : ''}`")
    expect(source).not.toContain("siteActions.className = 'chat-row tiny'")
    expect(source).not.toContain('roleSiteBadge(role.chatSite)')
    expect(html).toMatch(/\.site-pill\s*{[^}]*border-radius:\s*999px;/s)
    expect(html).toMatch(/\.add-person-site-option\s*{[^}]*border-color:\s*rgba\(132,\s*153,\s*171,\s*0\.22\);[^}]*background:\s*rgba\(132,\s*153,\s*171,\s*0\.08\);[^}]*color:\s*var\(--muted\);/s)
    expect(html).toMatch(/\.add-person-site-option\.active\s*{[^}]*border-color:\s*rgba\(47,\s*216,\s*204,\s*0\.56\);[^}]*background:\s*rgba\(47,\s*216,\s*204,\s*0\.16\);[^}]*color:\s*#eaffff;/s)
    expect(html).toMatch(/\.role-site-menu\s*{[^}]*position:\s*absolute;/s)
  })

  it('normalizes light theme site pills so model badges do not leak dark brand colors', () => {
    const html = readTeamDocument()

    for (const siteClass of ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok', 'external']) {
      expect(html).toMatch(new RegExp(`:root\\[data-theme="light"\\] \\.site-pill-${siteClass}\\s*{[^}]*background:\\s*#f6f7f8;[^}]*color:\\s*#4b5563;`, 's'))
    }
    expect(html).toMatch(/:root\[data-theme="light"\] #iframe-host \.role-frame-site\s*{[^}]*background:\s*#f6f7f8;[^}]*color:\s*#4b5563;/s)
  })

  it('does not keep a global add-person site picker', () => {
    const html = readTeamDocument()

    expect(html).not.toContain('name="add-person-chat-site"')
    expect(html).toContain('<button class="btn btn-primary" type="submit">添加人员</button>')
    expect(html).not.toContain('打开添加人员')
    expect(html).not.toContain('为这次加入群聊的人员统一指定 Gemini。')
    expect(html).not.toContain('为这次加入群聊的人员统一指定 ChatGPT。')
    expect(html).not.toContain('为这次加入群聊的人员统一指定 Claude。')
    expect(html).not.toContain(`为这次加入群聊的人员统一指定${removedSiteLabel(REMOVED_SITE_IDS[1])}。`)
  })

  it('adds search and built-in/custom tabs to the add-person dialog', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')
    const domRefsSource = readFileSync(resolve(process.cwd(), 'src/teamPage/domRefs.ts'), 'utf8')

    expect(html).toContain('id="add-person-search"')
    expect(html).toContain('id="add-person-tab-builtin"')
    expect(html).toContain('id="add-person-tab-custom"')
    expect(html).toContain('搜索人员名称、描述或提示词')
    expect(source).toContain('function filteredAddPersonItems(): AddPersonItem[]')
    expect(source).toContain("deps.state.addPersonTemplateType === 'builtin'")
    expect(source).toContain('matchesAddPersonSearch')
    expect(domRefsSource).toContain("'#add-person-search'")
    expect(domRefsSource).toContain("'#add-person-tab-builtin'")
    expect(domRefsSource).toContain("'#add-person-tab-custom'")
  })

  it('keeps long add-person lists scrollable without hiding the submit button', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/#add-person-modal \.modal\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s)
    expect(html).toMatch(/#add-person-modal \.modal\s*{[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/#add-library-people-form\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;/s)
    expect(html).toMatch(/#add-library-people-list\s*{[^}]*min-height:\s*0;/s)
    expect(html).toMatch(/#add-library-people-list\s*{[^}]*max-height:\s*none;/s)
    expect(html).toMatch(/#add-library-people-list\s*{[^}]*overflow:\s*auto;/s)
  })

  it('uses a deep desktop-style page background without decorative side panels', () => {
    const html = readTeamDocument()

    expect(html).not.toContain('body::before')
    expect(html).not.toContain('body::after')
    expect(html).toContain('--bg: #090d13;')
    expect(html).toMatch(/body\s*{[^}]*background:\s*[\s\S]*linear-gradient\(180deg,\s*#252a32,\s*#151a21 34%,\s*#090d13\);/s)
  })

  it('styles iframe background groups with chat and role labels', () => {
    const html = readTeamDocument()

    expect(html).toContain('.chat-frame-group-title')
    expect(html).toContain('.role-frame-shell')
    expect(html).toContain('.role-frame-label')
    expect(html).toMatch(/\.chat-frame-group-title\s*{[^}]*grid-column:\s*1 \/ -1;/s)
    expect(html).toMatch(/\.chat-frame-group-title\s*{[^}]*position:\s*sticky;/s)
    expect(html).toMatch(/\.chat-frame-group-title\s*{[^}]*top:\s*0;/s)
    expect(html).toMatch(/\.chat-frame-group-title\s*{[^}]*z-index:\s*2;/s)
    expect(html).toMatch(/\.role-frame-shell\s*{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s)
  })

  it('lays iframe chat groups as one group per row with up to three role frames per group', () => {
    const html = readTeamDocument()
    const hostRule = html.match(/#iframe-host\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const groupRule = html.match(/#iframe-host \.chat-frame-group\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(hostRule).toContain('display: flex;')
    expect(hostRule).toContain('flex-direction: column;')
    expect(hostRule).toContain('background: #000000;')
    expect(hostRule).toContain('scroll-snap-type: y proximity;')
    expect(hostRule).not.toContain('grid-template-columns')
    expect(html).not.toContain('#iframe-host::after')
    expect(groupRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(groupRule).toContain('grid-auto-rows: calc(100vh - 92px);')
    expect(groupRule).toContain('height: calc(100vh - 28px);')
    expect(groupRule).toContain('flex: 0 0 calc(100vh - 28px);')
    expect(groupRule).toContain('scroll-snap-align: start;')
    expect(groupRule).toContain('overflow: auto;')
    expect(groupRule).not.toContain('opacity:')
    expect(groupRule).not.toContain('auto-fit')
    expect(html).not.toMatch(/#iframe-host \.chat-frame-group\.background\s*{[^}]*opacity:/s)
  })

  it('makes the selected iframe chat group visibly highlighted without changing its layout', () => {
    const html = readTeamDocument()
    const activeGroupRule = html.match(/#iframe-host \.chat-frame-group\.active\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(activeGroupRule).toContain('outline: 2px solid rgba(47, 216, 204, 0.55);')
    expect(activeGroupRule).toContain('outline-offset: -2px;')
    expect(activeGroupRule).not.toContain('height')
    expect(activeGroupRule).not.toContain('grid-row')
    expect(activeGroupRule).not.toContain('transform')
  })

  it('does not render person settings inside the people drawer', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')

    expect(html).not.toContain('id="role-editor"')
    expect(html).not.toContain('人员设置')
    expect(html).not.toContain('id="edit-role-name"')
    expect(html).not.toContain('id="edit-role-description"')
    expect(html).not.toContain('id="edit-role-prompt"')
    expect(html).not.toContain('id="recover-role"')
    expect(html).not.toContain('id="initialize-role"')
    expect(html).not.toContain('id="new-role-name"')
    expect(source).not.toContain("'#role-editor'")
    expect(source).not.toContain("'#edit-role-name'")
    expect(source).not.toContain("'#recover-role'")
    expect(source).not.toContain("'#initialize-role'")
  })

  it('renders chat actions through a three-dot menu that updates, duplicates, and deletes chats', () => {
    const html = readTeamDocument()
    const chatListSource = readFileSync(resolve(process.cwd(), 'src/teamPage/chatListView.ts'), 'utf8')

    expect(chatListSource).toContain("menuButton.className = 'icon-btn chat-menu-btn'")
    expect(chatListSource).toContain("menuButton.textContent = '⋯'")
    expect(chatListSource).toContain("menu.className = 'chat-action-menu'")
    expect(chatListSource).toContain("rename.textContent = ui('编辑名称')")
    expect(chatListSource).toContain("duplicate.textContent = ui('复制群聊')")
    expect(chatListSource).toContain("exportRecord.textContent = ui('导出记录')")
    expect(chatListSource).toContain("clearMessages.textContent = ui('清空消息')")
    expect(chatListSource).toContain("closeFrames.textContent = ui('关闭群聊')")
    expect(chatListSource).toContain("remove.textContent = ui('删除群聊')")
    expect(chatListSource).toContain("runCommand('GROUP_CHAT_CLEAR_MESSAGES'")
    expect(chatListSource).toContain("runCommand('GROUP_CHAT_CLOSE'")
    expect(chatListSource).toContain("runCommand('GROUP_CHAT_UPDATE'")
    expect(chatListSource).toContain("runCommand('GROUP_CHAT_DUPLICATE'")
    expect(chatListSource).toContain('formatChatExportMarkdown')
    expect(chatListSource).toContain("sendRuntimeMessage('GROUP_CHAT_DELETE'")
    expect(chatListSource).toContain("response.error === 'Unknown OpenTeam message'")
    expect(chatListSource).toContain('deleteChatFromLocalStore(chatId)')
    expect(html).toMatch(/\.chat-action-menu\s*{[^}]*position:\s*absolute;/s)
    expect(html).toMatch(/\.chat-action-menu\s*{[^}]*right:\s*14px;/s)
    expect(html).not.toMatch(/\.chat-action-menu\s*{[^}]*grid-column:\s*2 \/ 4;/s)
  })

  it('renders a bottom-right floating window resize handle', () => {
    const html = readTeamDocument()

    expect(html).toContain('id="window-resize-handle"')
    expect(html).toContain('class="window-resize-handle"')
    expect(html).toMatch(/\.window-resize-handle\s*{[^}]*cursor:\s*nwse-resize;/s)
    expect(html).toMatch(/\.app-shell\.fullscreen \.window-resize-handle\s*{[^}]*display:\s*none;/s)
  })

  it('renders compact icon actions for assistant messages', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')
    const recoverySource = readFileSync(resolve(process.cwd(), 'src/teamPage/roleRecoveryController.ts'), 'utf8')

    expect(source).toContain("createMessageIconButton('跳转到原始窗口'")
    expect(source).toContain("createMessageIconButton('引用回复'")
    expect(source).toContain("createMessageIconButton('复制回复'")
    expect(source).toContain('showCopyFeedback(button)')
    expect(source).toContain("button.setAttribute('aria-label', '已复制')")
    expect(source).toContain("setMessageButtonIcon(button, 'check')")
    expect(source).toContain("setMessageButtonIcon(button, 'copy')")
    expect(source).toContain('deps.focusRoleFrame(message.chatId, message.roleId)')
    expect(source).toContain('copyMessageContent(message)')
    expect(source).toContain('navigator.clipboard.writeText(message.content)')
    expect(source).not.toContain("jump.textContent = '跳转'")
    expect(source).not.toContain("quote.textContent = '引用'")
    expect(recoverySource).toContain('setWindowMinimized(true)')
    expect(html).toContain('.role-frame-shell.jump-highlight')
    expect(html).toContain('.message-tool-btn')
    expect(html).toContain('.message-tool-btn::after')
    expect(html).toContain('content: attr(aria-label);')
    expect(source).not.toContain('button.title = label')
    expect(html).not.toMatch(/\.message-row\.assistant:hover \.message-tools/)
    expect(html).toMatch(/\.message-row\.thinking \.message-tools,\s*\.message-row\.stopped \.message-tools\s*{[^}]*opacity:\s*0;/s)
    expect(html).toMatch(/\.message-row\.thinking:hover \.message-tools,/s)
    expect(source).toContain("createMessageIconButton('停止回复'")
    expect(source).toContain("createMessageIconButton('重新发送'")
    expect(source).not.toContain("打断重试")
    expect(recoverySource).toContain("runCommand('GROUP_ROLE_STOP_REPLY'")
    expect(recoverySource).toContain("type: 'GROUP_ROLE_RETRY_REPLY'")
  })

  it('keeps add-person sites per person and moves temporary people into a separate draft flow', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/peopleLibraryView.ts'), 'utf8')
    const addPersonModal = html.match(/<div id="add-person-modal"[\s\S]*?<div id="temporary-person-modal"/)?.[0] ?? ''
    const temporaryModal = html.match(/<div id="temporary-person-modal"[\s\S]*?<div id="iframe-host"/)?.[0] ?? ''

    expect(addPersonModal).toContain('id="open-temporary-person"')
    expect(addPersonModal).not.toContain('id="add-person-site-gemini"')
    expect(addPersonModal).not.toContain('id="add-person-site-chatgpt"')
    expect(addPersonModal).not.toContain('id="add-person-site-claude"')
    expect(addPersonModal).not.toContain('id="add-person-site-deepseek"')
    for (const site of REMOVED_SITE_IDS) expect(addPersonModal).not.toContain(`id="add-person-site-${site}"`)
    expect(addPersonModal).not.toContain('id="add-temporary-person-form"')
    expect(temporaryModal).toContain('id="add-temporary-person-form"')
    expect(temporaryModal).toContain('id="close-temporary-person"')
    expect(source).toContain('temporaryPersonDrafts')
    expect(source).toContain('addPersonSiteControl')
    expect(source).toContain('selectedAddPersonItems()')
  })

  it('shows an add-person call to action when the selected chat has no people', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(source).toContain("emptyChatPeopleCard('暂无人员'")
    expect(source).toContain("button.textContent = '添加人员'")
    expect(source).toContain('deps.openAddPersonDialog')
  })

  it('switches chats from the whole chat row while keeping row menus isolated', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/chatListView.ts'), 'utf8')

    expect(source).toContain("item.addEventListener('click', () => switchChat(chat.id))")
    expect(source).toContain("item.addEventListener('keydown'")
    expect(source).toContain("item.tabIndex = 0")
    expect(source).toContain("item.setAttribute('role', 'button')")
    expect(source).toContain("menu.addEventListener('click', event => event.stopPropagation())")
  })

  it('hides the reference draft until quoting and keeps quoted text to one line', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/composerView.ts'), 'utf8')

    expect(html).toMatch(/\.reference-draft\[hidden\]\s*{[^}]*display:\s*none;/s)
    expect(html).toMatch(/\.reference-draft-preview\s*{[^}]*white-space:\s*nowrap;/s)
    expect(html).toMatch(/\.reference-draft-preview\s*{[^}]*text-overflow:\s*ellipsis;/s)
    expect(source).toContain("preview.className = 'reference-draft-preview'")
    expect(source).not.toContain("title.textContent = `引用 ${selectedReference.roleName || '人员'} 的观点`")
  })

  it('positions the mention panel next to the composer input instead of the right action area', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/composerView.ts'), 'utf8')

    expect(source).toContain('roleMentionLabel(role, mentionLabelOptions())')
    expect(source).toContain('roleModelLabel(role, mentionLabelOptions())')
    expect(source).toContain("site.className = `mention-site-badge ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`}`")
    expect(html).toMatch(/\.mention-panel\s*{[^}]*left:\s*12px;/s)
    expect(html).toMatch(/\.mention-panel\s*{[^}]*bottom:\s*calc\(100% \+ 8px\);/s)
    expect(html).toMatch(/\.mention-panel\s*{[^}]*width:\s*min\(280px,\s*calc\(100% - 24px\)\);/s)
    expect(html).toMatch(/\.mention-name\s*{[^}]*text-overflow:\s*ellipsis;/s)
    expect(html).toMatch(/\.mention-site-badge\s*{[^}]*border-radius:\s*999px;/s)
    expect(html).not.toMatch(/\.mention-panel\s*{[^}]*right:\s*78px;/s)
  })

  it('keeps mention keyboard selection visible in light theme', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/:root\[data-theme="light"\] \.mention-option:hover,\s*:root\[data-theme="light"\] \.mention-option\.active\s*{[^}]*background:\s*#e7f7f5;[^}]*color:\s*#0f3f45;[^}]*box-shadow:\s*inset 3px 0 0 #147f8f;/s)
    expect(html).not.toMatch(/:root\[data-theme="light"\] \.mention-option\.active\s*{[^}]*background:\s*#ffffff;/s)
  })

  it('keeps the sidebar header focused on chat creation instead of a refresh control', () => {
    const html = readTeamDocument()
    const uiSource = readFileSync(resolve(process.cwd(), 'src/teamPage/teamUiController.ts'), 'utf8')

    expect(html).not.toContain('id="refresh-store"')
    expect(html).not.toContain('aria-label="同步并恢复当前群聊"')
    expect(html).toContain('id="quick-create-chat"')
    expect(uiSource).not.toContain('#refresh-store')
    expect(uiSource).not.toContain('refreshCurrentChat().catch')
  })

  it('shrinks instead of closing the OpenTeam window from the close control', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/teamUiController.ts'), 'utf8')
    const floatingSource = readFileSync(resolve(process.cwd(), 'src/teamPage/floatingWindow.ts'), 'utf8')

    expect(source).not.toContain("window.confirm('确定要关闭 OpenTeam 窗口吗？')")
    expect(source).not.toContain('window.close()')
    expect(floatingSource).toContain("closeWindowEl?.addEventListener('click', () => setWindowMinimized(true))")
  })

  it('uses a refined composer and desktop-style chat header', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/chatHeaderView.ts'), 'utf8')
    const uiSource = readFileSync(resolve(process.cwd(), 'src/teamPage/teamUiController.ts'), 'utf8')

    expect(html).toContain('placeholder="输入消息，@成员可指定回复；不 @ 仅记录到群聊。"')
    expect(html).toMatch(/\.chat-header\s*{[^}]*min-height:\s*84px;/s)
    expect(html).toMatch(/\.chat-header\s*{[^}]*padding:\s*18px 36px 15px 24px;/s)
    expect(html).toMatch(/\.composer\s*{[^}]*margin:\s*0 22px 18px;/s)
    expect(html).toMatch(/\.composer\s*{[^}]*border:\s*1px solid rgba\(132,\s*153,\s*171,\s*0\.22\);/s)
    expect(html).toMatch(/\.drawer-summary\s*{[^}]*min-height:\s*30px;/s)
    expect(source).toContain("togglePeopleDrawerEl.textContent = ui('成员 0')")
    expect(source).toContain('deps.togglePeopleDrawerEl.textContent = ui(`成员 ${roles.length}`)')
    expect(source).toContain("deps.togglePeopleDrawerEl.setAttribute('aria-label', ui(deps.state.peopleDrawerOpen ? '收起成员面板' : '打开成员面板'))")
    expect(uiSource).toContain('deps.state.peopleDrawerOpen && target && !deps.rolePanelEl.contains(target) && !deps.togglePeopleDrawerEl.contains(target)')
    expect(uiSource).toContain('deps.state.peopleDrawerOpen = false')
    expect(source).not.toContain('人回复中')
  })

  it('keeps right member card controls as borderless icons with horizontal status text', () => {
    const css = readTeamCss()
    const roleActionsRule = css.match(/(?:^|\n)\.role-delete,\s*\.role-prompt-detail,\s*\.role-refresh,\s*\.role-jump\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const detailRule = css.match(/(?:^|\n)\.role-prompt-detail\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const statusRule = css.match(/(?:^|\n)\.status-pill,\s*\.mention-chip\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const roleStatusRule = css.match(/(?:^|\n)\.role-card \.status-pill\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(roleActionsRule).toContain('appearance: none;')
    expect(roleActionsRule).toContain('border: 0;')
    expect(roleActionsRule).toContain('background: transparent;')
    expect(detailRule).not.toContain('border:')
    expect(detailRule).not.toContain('background:')
    expect(statusRule).toContain('white-space: nowrap;')
    expect(roleStatusRule).toContain('flex: 0 0 auto;')
    expect(roleStatusRule).toContain('position: absolute;')
    expect(roleStatusRule).toContain('top: 12px;')
    expect(roleStatusRule).toContain('right: 12px;')
    expect(roleStatusRule).toContain('margin-left: 0;')
    expect(css).not.toMatch(/:root\[data-theme="light"\] \.role-prompt-detail,/)
  })

  it('places user messages on the right like a WeChat conversation', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/\.message-row\.user\s*{[^}]*justify-content:\s*flex-end;/s)
    expect(html).toMatch(/\.message-row\.user \.message-inner\s*{[^}]*flex-direction:\s*row-reverse;/s)
    expect(html).toMatch(/\.message-row\.user \.message-bubble\s*{[^}]*background:\s*#35d18c;/s)
    expect(html).toMatch(/\.message-row\.user \.message-bubble::before\s*{[^}]*border-left-color:\s*#35d18c;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.message-row\.user \.message-bubble\s*{[^}]*background:\s*#b0f0a7;/s)
    expect(html).toMatch(/:root\[data-theme="light"\] \.message-row\.user \.message-bubble::before\s*{[^}]*border-left-color:\s*#b0f0a7;/s)
    expect(html).not.toContain('.message-content')
  })

  it('renders time dividers and system messages as centered pills', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(source).toContain("divider.className = 'message-time-divider'")
    expect(source).toContain("pill.className = 'message-system-pill'")
    expect(html).toMatch(/\.message-time-divider\s*{[^}]*align-self:\s*center;/s)
    expect(html).toMatch(/\.message-system-pill\s*{[^}]*border-radius:\s*999px;/s)
  })

  it('wraps group template categories instead of showing a horizontal scroller', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/\.group-template-categories\s*{[^}]*flex-wrap:\s*wrap;/s)
    expect(html).not.toMatch(/\.group-template-categories\s*{[^}]*overflow-x:\s*auto;/s)
  })

  it('keeps group template cards roomy and descriptions fully readable', () => {
    const html = readTeamDocument()

    expect(html).toMatch(/\.group-template-modal\s*{[^}]*width:\s*min\(1500px,\s*calc\(100vw - 32px\)\);/s)
    expect(html).toMatch(/\.group-template-modal\s*{[^}]*min-height:\s*min\(820px,\s*calc\(100vh - 24px\)\);/s)
    expect(html).toMatch(/\.group-template-list\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(520px,\s*1fr\)\);/s)
    expect(html).toMatch(/\.group-template-option\s*{[^}]*min-height:\s*190px;/s)
    expect(html).toMatch(/\.group-template-summary\s*{[^}]*display:\s*-webkit-box;/s)
    expect(html).toMatch(/\.group-template-summary\s*{[^}]*overflow:\s*hidden;/s)
    expect(html).toMatch(/\.group-template-summary\s*{[^}]*-webkit-line-clamp:\s*2;/s)
    expect(html).not.toMatch(/\.group-template-option\.has-long-summary:hover \.group-template-summary/s)
    expect(html).not.toMatch(/\.group-template-option\.has-long-summary:focus-visible \.group-template-summary/s)
    expect(html).not.toMatch(/\.group-template-summary\s*{[^}]*overflow:\s*visible;/s)
    expect(html).not.toMatch(/\.group-template-summary\s*{[^}]*-webkit-line-clamp:\s*unset;/s)
    expect(html).not.toMatch(/\.group-template-meta\s*{[^}]*white-space:\s*nowrap;/s)
    expect(html).not.toMatch(/\.group-template-meta\s*{[^}]*text-overflow:\s*ellipsis;/s)
    expect(html).not.toContain('群聊介绍 · 悬浮查看')
    expect(html).not.toContain('group-template-summary-collapsed')
  })

  it('renders explicit mentions inline inside user message bubbles', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(source).toContain('renderMessageMentions(message)')
    expect(source).toContain('appendMentionsToBody(body, mentions)')
    expect(source).toContain('message.mentionedRoleIds')
    expect(source).toContain('roleMentionLabel(role, mentionLabelOptions())')
    expect(html).toMatch(/\.message-mentions\s*{[^}]*display:\s*inline-flex;/s)
    expect(html).toMatch(/\.message-mention\s*{[^}]*font-weight:\s*820;/s)
  })

  it('renders copied markdown replies with markdown-it while keeping other messages on the plain-text renderer', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(source).toContain('shouldRenderMarkdownMessage(message)')
    expect(source).toContain("message.contentFormat === 'markdown' || message.type === 'assistant'")
    expect(source).toContain('renderMarkdownMessageBody(body, message.content)')
    expect(source).toContain('renderPlainMessageBody(body, message.content)')
    expect(source).toContain('pill.append(document.createTextNode(message.content))')
    expect(source).toContain('MarkdownIt')
    expect(source).toContain('body.innerHTML = markdownRenderer.render(normalizeAssistantMarkdown(content))')
    expect(html).toMatch(/\.message-body\s*{[^}]*white-space:\s*pre-wrap;/s)
    expect(html).toContain('.message-body.markdown-body')
  })

  it('keeps chat titles as plain text and omits chat status from list rows', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/chatListView.ts'), 'utf8')

    expect(source).toContain("name.className = 'chat-name'")
    expect(source).not.toContain("name.className = 'chat-name btn btn-ghost'")
    expect(source).not.toContain("meta.className = 'chat-meta tiny'")
    expect(source).not.toContain('statusPill(chat.status')
    expect(html).not.toContain('.chat-meta')
    expect(html).not.toContain('.chat-item .chat-name::before')
  })

  it('uses a WeChat-like chat list row with avatar, body, and right time column', () => {
    const html = readTeamDocument()
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/chatListView.ts'), 'utf8')

    expect(source).toContain("avatar.className = `chat-avatar ${deps.roleToneClass(chat.name)}`")
    expect(source).toContain("body.className = 'chat-item-body'")
    expect(source).toContain("side.className = 'chat-item-side'")
    expect(source).toContain("time.className = 'chat-time'")
    expect(source).toContain("time.textContent = formatChatListTime(chat.updatedAt)")
    expect(source).not.toContain("textNode(`${chat.roleIds.length} 人员 · ${formatTime(chat.updatedAt)}`)")
    expect(html).toMatch(/\.chat-list\s*{[^}]*--chat-list-row-height:\s*70px;/s)
    expect(html).toMatch(/\.chat-list\s*{[^}]*gap:\s*5px;/s)
    expect(html).toMatch(/\.chat-item\s*{[^}]*grid-template-columns:\s*40px minmax\(0, 1fr\) auto;/s)
    expect(html).toContain('.chat-avatar')
    expect(html).toContain('.chat-time')
    expect(html).toMatch(/\.chat-time\s*{[^}]*font-size:\s*10px;/s)
    expect(html).toMatch(/\.summary-line\s*{[^}]*white-space:\s*nowrap;/s)
    expect(html).toMatch(/\.summary-line\s*{[^}]*text-overflow:\s*ellipsis;/s)
  })

  it('keeps chat switching to one store write and one store application', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/chatListView.ts'), 'utf8')
    const runtimeSource = readFileSync(resolve(process.cwd(), 'src/teamPage/runtimeClient.ts'), 'utf8')

    expect(source).toContain("runCommand('GROUP_CHAT_SWITCH', { chatId })")
    expect(source).toContain('deps.renderSelectedChat()')
    expect(source).toContain('window.requestAnimationFrame(() => {')
    expect(source).not.toContain("runCommand('GROUP_CHAT_MARK_READ', { chatId })")
    expect(runtimeSource).toMatch(/if \(response\.store\) \{\s*deps\.applyStore\(response\.store\)\s*return\s*\}/s)
    expect(runtimeSource).not.toMatch(/if \(response\.store\) deps\.applyStore\(response\.store\)\s*await deps\.refreshStore\(false\)/s)
  })

  it('avoids layout-changing iframe group transitions while switching chats', () => {
    const html = readTeamDocument()
    const activeGroupRule = html.match(/#iframe-host \.chat-frame-group\.active\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const groupRule = html.match(/#iframe-host \.chat-frame-group\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(activeGroupRule).not.toContain('grid-row')
    expect(activeGroupRule).not.toContain('transform')
    expect(groupRule).not.toContain('transform: scale')
    expect(groupRule).not.toMatch(/transition:[^;]*transform/)
  })

  it('reuses rendered message nodes so returning to a chat is cheap', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(source).toContain('messageNodeCache')
    expect(source).toContain('renderMessageNode(item.message, item.showName, item.showAvatar)')
    expect(source).toContain('messageSignature(message, showName, showAvatar)')
  })
})
