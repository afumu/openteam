// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

describe('team page dom refs', () => {
  it('collects required team page elements and fails clearly when a selector is missing', async () => {
    document.body.innerHTML = `
      <main id="app"><div id="iframe-host"></div></main>
      <button id="close-window"></button>
      <button id="toggle-window-size"></button>
      <button id="toggle-fullscreen"></button>
      <section id="store-summary"></section>
      <section id="chat-list"></section>
      <h1 id="chat-title"></h1>
      <p id="chat-subtitle"></p>
      <div id="chat-status"></div>
      <section id="messages"></section>
      <div id="role-summary"></div>
      <section id="role-list"></section>
      <select id="role-template-select"></select>
      <section id="template-list"></section>
      <div id="target-preview"></div>
      <div id="busy-preview"></div>
      <form id="composer"></form>
      <button id="send-message"></button>
      <textarea id="message-input"></textarea>
      <div id="reference-draft"></div>
      <div id="mention-panel"></div>
      <div id="error"></div>
      <input id="new-chat-name" />
      <form id="create-chat-form"></form>
      <button id="quick-create-chat"></button>
      <input id="template-name" />
      <textarea id="template-description"></textarea>
      <textarea id="template-prompt"></textarea>
      <textarea id="template-ai-description"></textarea>
      <button id="generate-template-persona"></button>
      <div id="template-persona-generation-status"></div>
      <div id="template-form-title"></div>
      <button id="settings-button"></button>
      <div id="settings-menu"></div>
      <button id="language-en"></button>
      <button id="language-zh"></button>
      <button id="agent-control-toggle"></button>
      <p id="agent-control-status"></p>
      <button id="theme-light"></button>
      <button id="theme-dark"></button>
      <button id="open-all-notes"></button>
      <button id="open-external-models"></button>
      <button id="open-orchestration"></button>
      <button id="close-orchestration"></button>
      <div id="orchestration-modal"></div>
      <div id="orchestration-auto-modal"></div>
      <textarea id="orchestration-task"></textarea>
      <button id="auto-orchestration"></button>
      <button id="open-orchestration-template"></button>
      <div id="orchestration-template-modal"></div>
      <button id="close-orchestration-template"></button>
      <div id="orchestration-template-content"></div>
      <button id="close-auto-orchestration"></button>
      <div id="orchestration-auto-content"></div>
      <div id="orchestration-people-list"></div>
      <button id="arrange-orchestration"></button>
      <div id="orchestration-stage-canvas"></div>
      <p id="orchestration-empty-hint"></p>
      <div id="orchestration-stage-settings"></div>
      <div id="orchestration-review-settings"></div>
      <input id="orchestration-max-rounds" />
      <button id="save-orchestration"></button>
      <button id="run-orchestration"></button>
      <button id="close-external-models"></button>
      <div id="external-models-modal"></div>
      <div id="external-models-list"></div>
      <form id="external-model-form"></form>
      <input id="external-model-id" />
      <input id="external-model-name" />
      <select id="external-model-format"></select>
      <input id="external-model-base-url" />
      <input id="external-model-api-key" />
      <input id="external-model-model-name" />
      <button id="reset-external-model-form"></button>
      <button id="close-all-notes"></button>
      <div id="all-notes-modal"></div>
      <div id="all-notes-list"></div>
      <h3 id="all-notes-active-title"></h3>
      <div id="all-notes-active-meta"></div>
      <div id="all-notes-editor"></div>
      <button id="all-note-bold"></button>
      <button id="all-note-italic"></button>
      <button id="all-note-strike"></button>
      <button id="all-note-bullet-list"></button>
      <button id="all-note-ordered-list"></button>
      <button id="all-note-undo"></button>
      <button id="all-note-redo"></button>
      <button id="open-people-library"></button>
      <button id="close-people-library"></button>
      <div id="people-library-modal"></div>
      <div id="person-template-modal"></div>
      <div id="add-person-modal"></div>
      <div id="temporary-person-modal"></div>
      <aside id="notes-panel"></aside>
      <div id="notes-drag-handle"></div>
      <button id="notes-resize-handle"></button>
      <button id="toggle-notes-panel"></button>
      <button id="close-notes-panel"></button>
      <button id="global-note-tab"></button>
      <button id="chat-note-tab"></button>
      <div id="notes-editor"></div>
      <button id="note-bold"></button>
      <button id="note-italic"></button>
      <button id="note-strike"></button>
      <button id="note-bullet-list"></button>
      <button id="note-ordered-list"></button>
      <button id="note-undo"></button>
      <button id="note-redo"></button>
      <div id="people-library-summary"></div>
      <div id="people-library-list"></div>
      <div id="people-library-pagination"></div>
      <input id="people-library-search" />
      <div id="people-library-category-filter"></div>
      <button id="people-library-tab-builtin"></button>
      <button id="people-library-tab-custom"></button>
      <div id="add-library-people-list"></div>
      <input id="add-person-search" />
      <div id="add-person-category-filter"></div>
      <button id="add-person-tab-builtin"></button>
      <button id="add-person-tab-custom"></button>
      <div id="builtin-template-detail-modal"></div>
      <h2 id="builtin-template-detail-title"></h2>
      <div id="builtin-template-detail-meta"></div>
      <pre id="builtin-template-detail-prompt"></pre>
      <button id="close-builtin-template-detail"></button>
      <button id="new-template"></button>
      <button id="close-person-template"></button>
      <button id="close-add-person"></button>
      <button id="open-temporary-person"></button>
      <button id="close-temporary-person"></button>
      <form id="add-role-form"></form>
      <form id="add-library-people-form"></form>
      <form id="add-temporary-person-form"></form>
      <form id="people-library-form"></form>
      <input id="template-site-gemini" />
      <input id="template-site-chatgpt" />
      <input id="template-site-claude" />
      <input id="template-site-deepseek" />
      <input id="template-site-grok" />
      <input id="template-site-qwen" />
      <input id="template-site-external" />
      <div id="template-external-model-field"></div>
      <select id="template-external-model-select"></select>
      <div id="template-chatgpt-gpts-field"></div>
      <input id="template-chatgpt-gpts-url" />
      <div id="template-grok-project-field"></div>
      <input id="template-grok-project-url" />
      <input id="temporary-person-name" />
      <textarea id="temporary-person-description"></textarea>
      <textarea id="temporary-person-prompt"></textarea>
      <button id="toggle-people-drawer"></button>
      <aside class="role-panel"></aside>
      <button id="window-launcher"></button>
      <button id="window-resize-handle"></button>
    `

    const { createTeamPageDomRefs, requireElement } = await import('./domRefs')
    const refs = createTeamPageDomRefs()

    expect(refs.appShellEl.id).toBe('app')
    expect(refs.closeWindowEl.id).toBe('close-window')
    expect(refs.toggleFullscreenEl.id).toBe('toggle-fullscreen')
    expect(refs.themeLightEl.id).toBe('theme-light')
    expect(refs.themeDarkEl.id).toBe('theme-dark')
    expect(refs.openOrchestrationEl.id).toBe('open-orchestration')
    expect(refs.autoOrchestrationEl.id).toBe('auto-orchestration')
    expect(refs.orchestrationMaxRoundsEl.id).toBe('orchestration-max-rounds')
    expect(refs.generateTemplatePersonaEl.id).toBe('generate-template-persona')
    expect(refs.peopleLibraryCategoryFilterEl.id).toBe('people-library-category-filter')
    expect(refs.addPersonCategoryFilterEl.id).toBe('add-person-category-filter')
    expect(refs.windowResizeHandleEl.id).toBe('window-resize-handle')
    expect(refs.messageInputEl.tagName).toBe('TEXTAREA')
    expect(refs.rolePanelEl.className).toBe('role-panel')
    expect(() => requireElement('#missing')).toThrow('Missing element: #missing')
  })
})
