import {
  DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS,
  type ChatSite,
  type ExternalModelConfig,
  type GroupChat,
  type GroupRole,
  type OpenTeamStore,
  type OrchestrationFlow,
  type OrchestrationGraphEdge,
  type OrchestrationRun,
  type OrchestrationStage,
  type OrchestrationStageRun,
} from '../group/types'
import { runCommandWithReconnect } from './sendWithReconnect'

export interface OrchestrationStatusViewDependencies {
  getStore(): OpenTeamStore
  getCurrentChat(): GroupChat | undefined
  getCurrentRoles(): GroupRole[]
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
}

export interface OrchestrationStatusView {
  renderOrchestrationStatus(): HTMLElement | undefined
}

interface FloatingPrefs {
  collapsed?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

interface DragOptions {
  persistSize?: boolean
}

interface VisibleRun {
  run: OrchestrationRun
}

interface DiagramNode {
  stage: OrchestrationStage
  x: number
  y: number
  width: number
  height: number
}

const STATUS_LABELS: Record<OrchestrationRun['status'], string> = {
  pending: '编排等待中',
  running: '编排运行中',
  completed: '编排已完成',
  stopped: '编排已停止',
  error: '编排出错',
}
const FLOATING_PREFS_KEY_PREFIX = 'openteam.orchestrationFloatingStatus.'
const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_CARD_WIDTH = 390
const DEFAULT_CARD_HEIGHT = 376
const MIN_CARD_WIDTH = 300
const MIN_CARD_HEIGHT = 220
const MAX_CARD_WIDTH = 720
const MAX_CARD_HEIGHT = 620
const VIEWPORT_PADDING = 8

export function createOrchestrationStatusView(deps: OrchestrationStatusViewDependencies): OrchestrationStatusView {
  const pendingRetryActions = new Set<string>()

  function renderOrchestrationStatus(): HTMLElement | undefined {
    const chat = deps.getCurrentChat()
    if (!chat) return undefined
    const store = deps.getStore()
    const visible = getVisibleRun(store, chat.id)
    if (!visible) return undefined
    const flow = store.orchestrationFlowsById[visible.run.flowId]
    if (!flow) return undefined
    const prefs = readPrefs(chat.id)
    if (prefs.collapsed) return renderCollapsed(chat, visible.run, flow, prefs)
    return renderExpanded(chat, visible.run, flow, prefs)
  }

  function renderCollapsed(chat: GroupChat, run: OrchestrationRun, flow: OrchestrationFlow, _prefs: FloatingPrefs): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `orchestration-status orchestration-status-floating orchestration-status-collapsed orchestration-status-${run.status}`
    const label = `${STATUS_LABELS[run.status]} · ${currentNodeText(run, flow)} · ${run.stageRuns.length} / ${maxExecutions(run)}`
    button.textContent = '编'
    button.title = label
    button.setAttribute('aria-label', `${label}，点击展开`)
    button.addEventListener('click', () => {
      const nextPrefs = { ...readPrefs(chat.id), collapsed: false }
      writePrefs(chat.id, nextPrefs)
      button.replaceWith(renderExpanded(chat, run, flow, nextPrefs))
    })
    return button
  }

  function renderExpanded(chat: GroupChat, run: OrchestrationRun, flow: OrchestrationFlow, prefs: FloatingPrefs): HTMLElement {
    const current = currentStageRun(run)
    const card = document.createElement('section')
    card.className = `orchestration-status orchestration-status-floating orchestration-status-${run.status}`
    card.dataset.runId = run.id
    card.setAttribute('aria-label', '编排运行状态')
    applyFloatingPosition(card, prefs, { width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT })

    const header = document.createElement('div')
    header.className = 'orchestration-status-header'
    const title = document.createElement('div')
    title.className = 'orchestration-status-title'
    const dragGrip = document.createElement('span')
    dragGrip.className = 'orchestration-status-drag-grip'
    dragGrip.textContent = '⋮⋮'
    const titleText = document.createElement('span')
    
    let statusLabel = STATUS_LABELS[run.status]
    if (run.status === 'running' && run.updatedAt) {
      const staleThreshold = 10 * 60 * 1000
      if (Date.now() - run.updatedAt > staleThreshold) {
        statusLabel = '编排运行超时'
      }
    }
    titleText.textContent = statusLabel
    title.append(dragGrip, titleText)
    header.append(title)

    const headerActions = document.createElement('div')
    headerActions.className = 'orchestration-status-window-actions'
    const statusActions = renderActions(chat, run, flow, current)
    if (statusActions) headerActions.append(statusActions)
    const collapse = actionButton('－', 'orchestration-status-collapse', () => {
      const nextPrefs = { ...readPrefs(chat.id), collapsed: true }
      writePrefs(chat.id, nextPrefs)
      card.replaceWith(renderCollapsed(chat, run, flow, nextPrefs))
    })
    collapse.setAttribute('aria-label', '收起编排状态')
    headerActions.append(collapse)
    if (run.status === 'running' || run.status === 'pending') {
      headerActions.append(actionButton('停止', 'btn-danger', () => runAction('GROUP_ORCHESTRATION_STOP', { chatId: chat.id })))
    }
    header.append(headerActions)
    card.append(header)
    makeDraggable(card, header, chat.id)

    const body = document.createElement('div')
    body.className = 'orchestration-status-body'
    body.append(renderProgress(run, flow, current))
    const currentPanel = renderCurrentPanel(run, flow, current)
    if (currentPanel) body.append(currentPanel)
    const waiting = renderWaitingPanel(run, flow)
    if (waiting) body.append(waiting)
    body.append(renderMiniFlow(run, flow, deps.getStore(), rolesById()))
    const resizeHandle = document.createElement('button')
    resizeHandle.type = 'button'
    resizeHandle.className = 'orchestration-status-resize'
    resizeHandle.setAttribute('aria-label', '调整编排状态大小')
    makeResizable(card, resizeHandle, chat.id)
    card.append(body, resizeHandle)
    return card
  }

  function renderProgress(run: OrchestrationRun, flow: OrchestrationFlow, current: OrchestrationStageRun | undefined): HTMLElement {
    const row = document.createElement('div')
    row.className = 'orchestration-status-progress'
    const count = document.createElement('div')
    count.className = 'orchestration-status-count'
    const value = document.createElement('strong')
    value.textContent = `${run.stageRuns.length} / ${maxExecutions(run)}`
    const label = document.createElement('span')
    label.textContent = '已执行节点数'
    count.append(value, label)
    const node = document.createElement('div')
    node.className = 'orchestration-status-node-index'
    node.textContent = `节点 ${current ? current.stageIndex + 1 : Math.min(run.stageRuns.length + 1, flow.stages.length)} / ${Math.max(1, flow.stages.length)}`
    row.append(count, node)
    return row
  }

  function renderCurrentPanel(run: OrchestrationRun, flow: OrchestrationFlow, current: OrchestrationStageRun | undefined): HTMLElement | undefined {
    if (!current) return undefined
    const stage = flow.stages[current.stageIndex]
    if (!stage) return undefined
    const panel = document.createElement('div')
    panel.className = 'orchestration-status-current'
    const eyebrow = document.createElement('div')
    eyebrow.className = 'orchestration-status-current-label'
    eyebrow.textContent = current.status === 'error' ? '失败节点' : '当前节点'
    const main = document.createElement('div')
    main.className = 'orchestration-status-current-main'
    main.textContent = stage.kind === 'review' ? `审核 · ${stageStatusLabel(stage, rolesById(), deps.getStore())}` : stageStatusLabel(stage, rolesById(), deps.getStore())
    const sub = document.createElement('div')
    sub.className = 'orchestration-status-current-sub'
    sub.textContent = stage.description?.trim() || currentStatusText(current)
    panel.append(eyebrow, main, sub)
    if (stage.kind === 'review') {
      const meta = document.createElement('div')
      meta.className = 'orchestration-status-review-meta'
      const attempts = document.createElement('span')
      attempts.textContent = `审核次数 ${reviewAttemptCount(run, stage.id)} / ${reviewMaxAttempts(stage)}`
      const action = document.createElement('span')
      action.textContent = stage.review?.onMaxAttempts === 'continue' ? '上限后：继续往下走' : '上限后：停止流程'
      meta.append(attempts, action)
      panel.append(meta)
    }
    return panel
  }

  function renderWaitingPanel(run: OrchestrationRun, flow: OrchestrationFlow): HTMLElement | undefined {
    if (run.status !== 'running' && run.status !== 'pending') return undefined
    const current = currentStageRun(run)
    const nextIndex = current ? current.stageIndex + 1 : run.stageRuns.length
    const waiting = flow.stages.slice(nextIndex).map(stage => stageStatusLabel(stage, rolesById(), deps.getStore()))
    if (waiting.length === 0) return undefined
    const panel = document.createElement('div')
    panel.className = 'orchestration-status-waiting'
    const label = document.createElement('span')
    label.textContent = '等待'
    const value = document.createElement('strong')
    value.textContent = waiting.join('、')
    panel.append(label, value)
    return panel
  }

  function renderActions(chat: GroupChat, run: OrchestrationRun, flow: OrchestrationFlow, current: OrchestrationStageRun | undefined): HTMLElement | undefined {
    const actions = document.createElement('div')
    actions.className = 'orchestration-status-actions'
    if (run.status === 'stopped') {
      actions.append(actionButton('继续', 'btn-primary', () => resumeAction(chat, run, flow)))
      actions.append(actionButton('重新运行', 'btn-ghost', () => rerunAction(chat, run, flow)))
    }
    if (run.status === 'completed') {
      actions.append(actionButton('重新运行', 'btn-primary', () => rerunAction(chat, run, flow)))
    }
    if ((run.status === 'error' || current?.status === 'error') && current) {
      if (current.kind === 'review') {
        actions.append(actionButton('重发', 'btn-primary', () => retryAction(chat, current, 'GROUP_ORCHESTRATION_RETRY_REVIEW', { chatId: chat.id })))
      } else {
        actions.append(actionButton('重发', 'btn-primary', () => retryAction(chat, current, 'GROUP_ORCHESTRATION_RETRY_STAGE', { chatId: chat.id, stageId: current.stageId })))
      }
      actions.append(actionButton('跳过节点', 'btn-ghost', () => runAction('GROUP_ORCHESTRATION_SKIP_STAGE', { chatId: chat.id, stageId: current.stageId })))
      actions.append(actionButton('重新运行', 'btn-ghost', () => rerunAction(chat, run, flow)))
    }

    if (run.status === 'running' && run.updatedAt && (Date.now() - run.updatedAt > 10 * 60 * 1000)) {
      actions.append(actionButton('强制重置', 'btn-danger', () => runAction('GROUP_ORCHESTRATION_STOP', { chatId: chat.id })))
    }
    return actions.childElementCount > 0 ? actions : undefined
  }

  function actionButton(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `btn ${extraClass}`
    button.textContent = label
    button.addEventListener('click', event => {
      event.stopPropagation()
      onClick()
    })
    return button
  }

  function runAction(type: string, payload: Record<string, unknown>): void {
    deps.runCommand(type, payload).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function rerunAction(chat: GroupChat, run: OrchestrationRun, flow: OrchestrationFlow): void {
    const task = runTaskText(run) || flow.description || flow.name
    runCommandWithReconnect(deps, { chat, roles: getFlowRoles(flow), type: 'GROUP_ORCHESTRATION_RUN', payload: { chatId: chat.id, flowId: flow.id, task }, preconnectAll: true })
      .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function resumeAction(chat: GroupChat, run: OrchestrationRun, flow: OrchestrationFlow): void {
    runCommandWithReconnect(deps, { chat, roles: getResumeRoles(run, flow), type: 'GROUP_ORCHESTRATION_RESUME', payload: { chatId: chat.id, runId: run.id }, preconnectAll: true })
      .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function retryAction(chat: GroupChat, current: OrchestrationStageRun, type: string, payload: Record<string, unknown>): void {
    const actionKey = retryActionKey(chat, type, payload)
    if (pendingRetryActions.has(actionKey)) return
    pendingRetryActions.add(actionKey)
    runCommandWithReconnect(deps, { chat, roles: getStageRoles(current), type, payload, preconnectAll: true })
      .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
      .finally(() => pendingRetryActions.delete(actionKey))
  }

  function retryActionKey(chat: GroupChat, type: string, payload: Record<string, unknown>): string {
    return `${chat.id}:${type}:${String(payload.stageId ?? '')}`
  }

  function getResumeRoles(run: OrchestrationRun, flow: OrchestrationFlow): GroupRole[] {
    const current = currentStageRun(run)
    if (current && (current.status === 'skipped' || current.status === 'error' || current.status === 'pending' || current.status === 'running')) {
      return getStageRoles(current)
    }
    return getFlowRoles(flow)
  }

  function getStageRoles(current: OrchestrationStageRun): GroupRole[] {
    const map = rolesById()
    return Object.keys(current.roleRuns).map(roleId => map.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function rolesById(): Map<string, GroupRole> {
    return new Map(deps.getCurrentRoles().map(role => [role.id, role]))
  }

  function getFlowRoles(flow: OrchestrationFlow): GroupRole[] {
    const map = rolesById()
    const roleIds = new Set(flow.stages.flatMap(stage => stage.roleIds))
    return [...roleIds].map(roleId => map.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function runTaskText(run: OrchestrationRun): string | undefined {
    const store = deps.getStore()
    const chat = store.chatsById[run.chatId]
    return chat?.messageIds
      .map(messageId => store.messagesById[messageId])
      .find(message => message?.orchestrationRunId === run.id && message.orchestrationKind === 'task')
      ?.content
      ?.trim()
  }

  return { renderOrchestrationStatus }
}

function renderMiniFlow(run: OrchestrationRun, flow: OrchestrationFlow, store: OpenTeamStore, rolesById: Map<string, GroupRole>): SVGSVGElement {
  const svg = svgEl('svg')
  svg.classList.add('orchestration-mini-flow')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', '编排流程示意图')
  const nodes = diagramNodes(flow)
  const edges = graphEdges(flow)
  const bounds = diagramBounds(nodes, edges)
  svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)

  const defs = svgEl('defs')
  const marker = svgEl('marker')
  marker.setAttribute('id', `orchestration-mini-arrow-${run.id}`)
  marker.setAttribute('viewBox', '0 0 10 10')
  marker.setAttribute('refX', '8')
  marker.setAttribute('refY', '5')
  marker.setAttribute('markerWidth', '5')
  marker.setAttribute('markerHeight', '5')
  marker.setAttribute('orient', 'auto-start-reverse')
  const arrow = svgEl('path')
  arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z')
  marker.append(arrow)
  defs.append(marker)
  svg.append(defs)

  const nodeById = new Map(nodes.map(node => [node.stage.id, node]))
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceStageId)
    const target = nodeById.get(edge.targetStageId)
    if (!source || !target) continue
    const path = svgEl('path')
    path.classList.add('orchestration-mini-edge')
    const branch = reviewEdgeBranch(edge, flow.stages)
    if (branch) path.classList.add(`branch-${branch}`)
    path.setAttribute('d', edgePath(source, target, edge))
    path.setAttribute('marker-end', `url(#orchestration-mini-arrow-${run.id})`)
    svg.append(path)
    if (branch) svg.append(edgeLabel(source, target, edge, branch))
  }

  const current = currentStageRun(run)
  const completedIds = new Set(run.stageRuns.filter(stageRun => stageRun.status === 'completed' || stageRun.status === 'skipped').map(stageRun => stageRun.stageId))
  const errorId = run.status === 'error' ? current?.stageId : undefined
  for (const node of nodes) {
    const shape = node.stage.kind === 'review' ? reviewNodeShape(node) : roleNodeShape(node)
    shape.dataset.nodeId = node.stage.id
    shape.classList.add('orchestration-mini-node')
    if (node.stage.id === current?.stageId) shape.classList.add('current')
    if (completedIds.has(node.stage.id)) shape.classList.add('completed')
    if (node.stage.id === errorId) shape.classList.add('error')
    svg.append(shape)
    svg.append(nodeLabel(node, miniNodeLines(node.stage, store, rolesById, run)))
  }
  return svg
}

function roleNodeShape(node: DiagramNode): SVGRectElement {
  const rect = svgEl('rect')
  rect.setAttribute('x', String(node.x))
  rect.setAttribute('y', String(node.y))
  rect.setAttribute('width', String(node.width))
  rect.setAttribute('height', String(node.height))
  rect.setAttribute('rx', '14')
  return rect
}

function reviewNodeShape(node: DiagramNode): SVGPolygonElement {
  const polygon = svgEl('polygon')
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  polygon.setAttribute('points', `${cx},${node.y} ${node.x + node.width},${cy} ${cx},${node.y + node.height} ${node.x},${cy}`)
  return polygon
}

function nodeLabel(node: DiagramNode, lines: string[]): SVGGElement {
  const group = svgEl('g')
  group.classList.add('orchestration-mini-label')
  const startY = node.y + node.height / 2 - (lines.length - 1) * 8
  for (const [index, line] of lines.entries()) {
    const text = svgEl('text')
    text.setAttribute('x', String(node.x + node.width / 2))
    text.setAttribute('y', String(startY + index * 17))
    text.setAttribute('text-anchor', 'middle')
    text.textContent = line
    group.append(text)
  }
  return group
}

function edgeLabel(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge, branch: 'pass' | 'fail'): SVGGElement {
  const points = edgePoints(source, target, edge)
  const middle = points[Math.floor(points.length / 2)]
  const group = svgEl('g')
  group.classList.add('orchestration-mini-edge-label')
  const rect = svgEl('rect')
  rect.setAttribute('x', String(middle.x - 24))
  rect.setAttribute('y', String(middle.y - 12))
  rect.setAttribute('width', '48')
  rect.setAttribute('height', '20')
  rect.setAttribute('rx', '8')
  const text = svgEl('text')
  text.setAttribute('x', String(middle.x))
  text.setAttribute('y', String(middle.y + 3))
  text.setAttribute('text-anchor', 'middle')
  text.textContent = branch === 'pass' ? '通过' : '不通过'
  group.append(rect, text)
  return group
}

function diagramNodes(flow: OrchestrationFlow): DiagramNode[] {
  const stages = flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages
  return stages.map((stage, index) => ({
    stage,
    x: stage.position?.x ?? 40 + index * 170,
    y: stage.position?.y ?? (stage.kind === 'review' ? 52 : 64),
    width: stage.kind === 'review' ? 116 : 128,
    height: stage.kind === 'review' ? 90 : 64,
  }))
}

function diagramBounds(nodes: DiagramNode[], edges: OrchestrationGraphEdge[]): { x: number; y: number; width: number; height: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    xs.push(node.x, node.x + node.width)
    ys.push(node.y, node.y + node.height)
  }
  for (const edge of edges) {
    for (const vertex of edge.vertices ?? []) {
      xs.push(vertex.x)
      ys.push(vertex.y)
    }
  }
  const minX = Math.min(...xs, 0) - 36
  const minY = Math.min(...ys, 0) - 36
  const maxX = Math.max(...xs, 360) + 36
  const maxY = Math.max(...ys, 180) + 36
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function graphEdges(flow: OrchestrationFlow): OrchestrationGraphEdge[] {
  if (flow.graph?.edges?.length) return flow.graph.edges
  return flow.stages.slice(0, -1).map((stage, index) => ({ sourceStageId: stage.id, targetStageId: flow.stages[index + 1].id }))
}

function edgePath(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge): string {
  return edgePoints(source, target, edge).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function edgePoints(source: DiagramNode, target: DiagramNode, edge: OrchestrationGraphEdge): Array<{ x: number; y: number }> {
  const fail = edge.sourcePort === 'fail'
  const start = fail
    ? { x: source.x + source.width / 2, y: source.y + source.height }
    : { x: source.x + source.width, y: source.y + source.height / 2 }
  const end = { x: target.x, y: target.y + target.height / 2 }
  if (edge.vertices?.length) return orthogonalPoints(start, edge.vertices, end)
  if (fail) {
    const laneY = Math.max(source.y + source.height, target.y + target.height) + 58
    return [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]
  }
  if (Math.abs(start.y - end.y) < 8) return [start, end]
  const midX = start.x + Math.max(34, (end.x - start.x) / 2)
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
}

function orthogonalPoints(start: { x: number; y: number }, vertices: Array<{ x: number; y: number }>, end: { x: number; y: number }): Array<{ x: number; y: number }> {
  const points = [start]
  let cursor = start
  for (const vertex of vertices) {
    if (cursor.x !== vertex.x && cursor.y !== vertex.y) points.push({ x: vertex.x, y: cursor.y })
    points.push(vertex)
    cursor = vertex
  }
  if (cursor.x !== end.x && cursor.y !== end.y) points.push({ x: end.x, y: cursor.y })
  points.push(end)
  return points
}

function currentStageRun(run: OrchestrationRun): OrchestrationStageRun | undefined {
  return [...run.stageRuns].reverse().find(stageRun => stageRun.status === 'running' || stageRun.status === 'error') ?? run.stageRuns[run.stageRuns.length - 1]
}

function currentNodeText(run: OrchestrationRun, flow: OrchestrationFlow): string {
  const current = currentStageRun(run)
  const stage = current ? flow.stages[current.stageIndex] : undefined
  return stage?.kind === 'review' ? '审核' : stage?.name ?? '未开始'
}

function currentStatusText(current: OrchestrationStageRun): string {
  if (current.status === 'running') return current.kind === 'review' ? '正在判断流程走向' : '正在执行'
  if (current.status === 'error') return current.kind === 'review' ? '审核失败' : '节点失败'
  if (current.status === 'skipped') return '已停止，等待继续'
  if (current.status === 'completed') return '已完成'
  return '等待执行'
}

function getVisibleRun(store: OpenTeamStore, chatId: string): VisibleRun | undefined {
  const activeRunId = store.activeOrchestrationRunIdByChatId[chatId]
  const activeRun = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
  if (activeRun) return { run: activeRun }
  const latest = Object.values(store.orchestrationRunsById)
    .filter(run => run.chatId === chatId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return latest ? { run: latest } : undefined
}

function stageStatusLabel(stage: OrchestrationStage, rolesById: Map<string, GroupRole>, store: OpenTeamStore): string {
  const roleIds = stage.kind === 'review' ? stage.review?.reviewerRoleIds ?? stage.roleIds : stage.roleIds
  const roleLabels = roleIds.map(roleId => roleStatusLabel(rolesById.get(roleId), roleId, store))
  return roleLabels.length > 0 ? roleLabels.join('、') : stage.name
}

function miniNodeLines(stage: OrchestrationStage, store: OpenTeamStore, rolesById: Map<string, GroupRole>, run: OrchestrationRun): string[] {
  const roleIds = stage.kind === 'review' ? stage.review?.reviewerRoleIds ?? stage.roleIds : stage.roleIds
  const firstRole = roleIds[0] ? rolesById.get(roleIds[0]) : undefined
  const name = firstRole?.name ?? stage.name
  const site = firstRole ? roleModelLabel(firstRole, store) : ''
  if (stage.kind === 'review') return [name, site, reviewAttemptText(run, stage)].filter(Boolean)
  if (roleIds.length > 1) return [name, `${roleIds.length} 人 · ${site}`].filter(Boolean)
  return [name, site].filter(Boolean)
}

function roleStatusLabel(role: GroupRole | undefined, fallbackId: string, store: OpenTeamStore): string {
  if (!role) return fallbackId
  return `${role.name}（${roleModelLabel(role, store)}）`
}

function roleModelLabel(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): string {
  if (role.modelSource === 'external' && role.externalModelId) return externalModelLabel(store.settings.externalModelsById[role.externalModelId])
  return siteLabel(role.chatSite ?? store.settings.defaultChatSite)
}

function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model?.name ?? 'API'
}

function siteLabel(site: ChatSite): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  if (site === 'qwen') return 'Qwen'
  return 'Gemini'
}

function maxExecutions(run: OrchestrationRun): number {
  return run.maxNodeExecutions ?? run.maxRounds
}

function reviewMaxAttempts(stage: OrchestrationStage): number {
  const value = stage.review?.maxAttempts
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS
  return Math.max(1, Math.floor(value))
}

function reviewAttemptCount(run: OrchestrationRun, stageId: string): number {
  return run.stageRuns.filter(stageRun => stageRun.stageId === stageId && stageRun.kind === 'review').length
}

function reviewAttemptText(run: OrchestrationRun, stage: OrchestrationStage): string {
  return `${reviewAttemptCount(run, stage.id)}/${reviewMaxAttempts(stage)}`
}

function reviewEdgeBranch(edge: OrchestrationGraphEdge, stages: OrchestrationStage[]): 'pass' | 'fail' | undefined {
  const sourceStage = stages.find(stage => stage.id === edge.sourceStageId)
  if (sourceStage?.kind !== 'review') return undefined
  if (edge.sourcePort === 'fail') return 'fail'
  return 'pass'
}

function applyFloatingPosition(element: HTMLElement, prefs: FloatingPrefs, defaults: { width: number; height: number }): void {
  const width = clampNumber(prefs.width ?? defaults.width, MIN_CARD_WIDTH, MAX_CARD_WIDTH)
  const height = clampNumber(prefs.height ?? defaults.height, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)
  element.style.width = `${width}px`
  if (!element.classList.contains('orchestration-status-collapsed')) element.style.height = `${height}px`
  if (typeof prefs.x === 'number' && typeof prefs.y === 'number') {
    const position = clampViewportPosition(prefs.x, prefs.y, width, height)
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
    element.style.right = 'auto'
    element.style.bottom = 'auto'
  }
}

function makeDraggable(card: HTMLElement, handle: HTMLElement, chatId: string, options: DragOptions = {}): () => boolean {
  const persistSize = options.persistSize ?? true
  let suppressNextClick = false
  handle.addEventListener('mousedown', event => {
    if (event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : undefined
    if (target?.closest('button') && target !== handle) return
    const rect = card.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = rect.left
    const startTop = rect.top
    let moved = false
    const onMove = (moveEvent: MouseEvent) => {
      if (Math.abs(moveEvent.clientX - startX) <= 3 && Math.abs(moveEvent.clientY - startY) <= 3) return
      if (!moved) {
        moved = true
        card.style.left = `${startLeft}px`
        card.style.top = `${startTop}px`
        card.style.right = 'auto'
        card.style.bottom = 'auto'
      }
      moveEvent.preventDefault()
      const width = card.offsetWidth || rect.width
      const height = card.offsetHeight || rect.height
      const nextPosition = clampViewportPosition(startLeft + moveEvent.clientX - startX, startTop + moveEvent.clientY - startY, width, height)
      const nextX = nextPosition.x
      const nextY = nextPosition.y
      card.style.left = `${nextX}px`
      card.style.top = `${nextY}px`
      card.style.right = 'auto'
      card.style.bottom = 'auto'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (!moved) return
      const rect = card.getBoundingClientRect()
      suppressNextClick = moved
      const sizeWidth = card.offsetWidth || rect.width
      const sizeHeight = card.offsetHeight || rect.height
      const position = clampViewportPosition(rect.left, rect.top, sizeWidth, sizeHeight)
      const nextPrefs: FloatingPrefs = { ...readPrefs(chatId), x: position.x, y: position.y }
      if (persistSize) {
        nextPrefs.width = sizeWidth
        nextPrefs.height = sizeHeight
      }
      writePrefs(chatId, nextPrefs)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
  return () => {
    const shouldSuppress = suppressNextClick
    suppressNextClick = false
    return shouldSuppress
  }
}

function makeResizable(card: HTMLElement, handle: HTMLElement, chatId: string): void {
  handle.addEventListener('mousedown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = card.offsetWidth || DEFAULT_CARD_WIDTH
    const startHeight = card.offsetHeight || DEFAULT_CARD_HEIGHT
    const onMove = (moveEvent: MouseEvent) => {
      const width = clampNumber(startWidth + moveEvent.clientX - startX, MIN_CARD_WIDTH, MAX_CARD_WIDTH)
      const height = clampNumber(startHeight + moveEvent.clientY - startY, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)
      card.style.width = `${width}px`
      card.style.height = `${height}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const rect = card.getBoundingClientRect()
      writePrefs(chatId, { ...readPrefs(chatId), x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

function readPrefs(chatId: string): FloatingPrefs {
  try {
    const raw = window.localStorage.getItem(`${FLOATING_PREFS_KEY_PREFIX}${chatId}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as FloatingPrefs
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writePrefs(chatId: string, prefs: FloatingPrefs): void {
  window.localStorage.setItem(`${FLOATING_PREFS_KEY_PREFIX}${chatId}`, JSON.stringify(prefs))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const safeMax = Math.max(min, max)
  return Math.min(safeMax, Math.max(min, value))
}

function clampViewportPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: clampNumber(x, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
    y: clampNumber(y, VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING),
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName)
}
