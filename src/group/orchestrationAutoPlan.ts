import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { ChatSite, GroupRole, OpenTeamStore, OrchestrationAutoPlanHistoryEntry, OrchestrationFlow } from './types'

export type AutoOrchestrationNodeKind = 'execute' | 'review'
export type AutoOrchestrationBranch = 'pass' | 'fail'

export interface AutoOrchestrationRolePlan {
  key: string
  reuseRoleId?: string
  name: string
  description?: string
  systemPrompt?: string
  preferredSite: ChatSite
  preferredSiteExplicit?: boolean
}

export interface AutoOrchestrationReviewPlan {
  criteria: string
  maxAttempts: number
  onMaxAttempts: 'stop' | 'continue'
}

export interface AutoOrchestrationNodePlan {
  id: string
  kind: AutoOrchestrationNodeKind
  roleKey: string
  title: string
  instruction: string
  review?: AutoOrchestrationReviewPlan
}

export interface AutoOrchestrationEdgePlan {
  from: string
  to: string
  branch?: AutoOrchestrationBranch
}

export interface AutoOrchestrationPlan {
  flowName: string
  maxNodeExecutions: number
  roles: AutoOrchestrationRolePlan[]
  nodes: AutoOrchestrationNodePlan[]
  edges: AutoOrchestrationEdgePlan[]
}

export interface AutoOrchestrationPromptInput {
  task: string
  instruction?: string
  existingRoles: GroupRole[]
  currentFlow?: OrchestrationFlow
  history?: OrchestrationAutoPlanHistoryEntry[]
  store: OpenTeamStore
}

const DEFAULT_NEW_ROLE_SITE: ChatSite = 'deepseek'
const MAX_AUTO_NODES = 8
const DEFAULT_AUTO_MAX_NODE_EXECUTIONS = 30

export function buildAutoOrchestrationPrompt(input: AutoOrchestrationPromptInput): string {
  const language = normalizeLanguage(input.store.settings.language)
  if (language === 'en') return buildEnglishAutoOrchestrationPrompt(input)

  return [
    '你是 OpenTeam 的 AI 群聊流程编排规划器。',
    '你只能返回 JSON，不能返回 Markdown，不能解释，不能使用代码块。',
    '',
    '目标：根据运行任务和本次编排指令，生成或修改一个可执行、可编辑的 AI 群聊编排流程。',
    '运行任务是流程运行时要完成的业务目标；本次编排指令只描述如何生成或修改流程，两者不要混淆。',
    '如果 currentFlow 存在，请基于 currentFlow 增量修改，尽量保留未被指令要求改变的人员、节点和连线。',
    '',
    '硬性约束：',
    '1. 如果 existingRoles 非空，优先复用 existingRoles，复用时 roles[].reuseRoleId 必须填 existingRoles 里的 id。',
    '2. 只有现有人员无法覆盖必要职责时，才创建新人员。',
    '3. 如果 existingRoles 为空，必须创建 2-5 个新人员。',
    '4. 每个 roles[].preferredSite 必须使用 "chatgpt"、"gemini"、"claude"、"deepseek" 或 "grok"；如果用户明确要求 ChatGPT、Gemini、Claude、DeepSeek 或 Grok 站点，相关人员必须使用对应站点。',
    '5. 不要创建 kind=parallel 的节点；并行通过一个节点连接多个后继节点表达。',
    '6. 多个上游节点连接到同一个节点表示汇合，该节点要等所有上游完成。',
    '7. 同一个 roleKey 不能出现在同一批可并行执行的节点中；同一人员要做多件事时必须串行。',
    '8. 执行节点 kind 使用 "execute"，审核节点 kind 使用 "review"。',
    '9. 每个节点只能有一个 roleKey。',
    '10. 审核节点必须有 review.criteria、review.maxAttempts、review.onMaxAttempts。',
    '11. 审核节点 fail 分支可以回到上游修改节点；pass 分支可以省略，省略表示通过后流程结束。',
    '12. 不要生成孤立节点，不要生成无法到达节点。',
    `13. 节点数不能超过 ${MAX_AUTO_NODES} 个。`,
    '14. maxNodeExecutions 根据流程复杂度设置，默认 30。',
    '15. 自动编排生成的人员可以根据本次指令更新 description 和 systemPrompt；复用普通现有人员时不要改写其人设。',
    `16. ${PROMPT_I18N['zh-CN'].personaLanguageInstruction}`,
    '',
    '可用站点：',
    JSON.stringify([
      { value: 'chatgpt', label: 'ChatGPT' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'claude', label: 'Claude' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'grok', label: 'Grok' },
    ], null, 2),
    `默认站点：${input.store.settings.defaultChatSite}`,
    '',
    '返回 JSON schema：',
    JSON.stringify({
      flowName: '流程名称',
      maxNodeExecutions: 30,
      roles: [
        {
          key: 'pm',
          reuseRoleId: '如果复用已有人员则填写，否则省略',
          name: '产品经理',
          description: '人员职责',
          systemPrompt: '人设提示词',
          preferredSite: 'chatgpt',
        },
      ],
      nodes: [
        {
          id: 'n1',
          kind: 'execute',
          roleKeys: ['pm'],
          title: '需求拆解',
          instruction: '这个节点要完成的具体任务',
        },
        {
          id: 'review',
          kind: 'review',
          roleKeys: ['reviewer'],
          title: '最终审核',
          instruction: '判断结果是否可交付',
          review: {
            criteria: '审核标准',
            maxAttempts: 3,
            onMaxAttempts: 'stop',
          },
        },
      ],
      edges: [
        { from: 'n1', to: 'review' },
        { from: 'review', to: 'n1', branch: 'fail' },
      ],
    }, null, 2),
    '',
    '运行任务：',
    input.task,
    '',
    '本次编排指令：',
    input.instruction?.trim() || input.task,
    '',
    'existingRoles：',
    JSON.stringify(input.existingRoles.map(role => summarizeExistingRole(role, input.store)), null, 2),
    '',
    '当前编排草稿：',
    input.currentFlow ? JSON.stringify(summarizeCurrentFlow(input.currentFlow), null, 2) : '无',
    '',
    '自动编排历史：',
    JSON.stringify(summarizeHistory(input.history ?? input.currentFlow?.autoPlanHistory ?? []), null, 2),
  ].join('\n')
}

function buildEnglishAutoOrchestrationPrompt(input: AutoOrchestrationPromptInput): string {
  return [
    'You are the OpenTeam AI group-chat workflow planner.',
    PROMPT_I18N.en.jsonOnly,
    '',
    'Goal: based on the run task and this orchestration instruction, generate or modify an executable, editable AI group-chat workflow.',
    'The run task is the business goal to accomplish when the workflow runs. This orchestration instruction only describes how to generate or modify the workflow. Do not confuse them.',
    'If currentFlow exists, modify it incrementally and preserve people, nodes, and edges that the instruction does not ask you to change.',
    '',
    'Hard constraints:',
    '1. Prefer reusing existingRoles when existingRoles is not empty. When reusing a role, roles[].reuseRoleId must be an id from existingRoles.',
    '2. Only create new people when existing people cannot cover a necessary responsibility.',
    '3. If existingRoles is empty, create 2-5 new people.',
    '4. Each roles[].preferredSite must be "chatgpt", "gemini", "claude", "deepseek", or "grok"; if the user explicitly requests ChatGPT, Gemini, Claude, DeepSeek, or Grok, assign the relevant people to that site.',
    '5. Do not create kind=parallel nodes. Express parallelism by connecting one node to multiple downstream nodes.',
    '6. Multiple upstream nodes connecting to one node means a join; that node waits for all upstream nodes to finish.',
    '7. The same roleKey cannot appear in nodes that may run in parallel. If the same person must do multiple things, make them serial.',
    '8. Use kind "execute" for execution nodes and kind "review" for review nodes.',
    '9. Each node must have exactly one roleKey.',
    '10. Review nodes must include review.criteria, review.maxAttempts, and review.onMaxAttempts.',
    '11. A review fail branch may go back to an upstream revision node; a pass branch may be omitted, which means the workflow ends after passing.',
    '12. Do not generate isolated or unreachable nodes.',
    `13. The workflow cannot exceed ${MAX_AUTO_NODES} nodes.`,
    '14. Set maxNodeExecutions based on workflow complexity; default to 30.',
    '15. Auto-generated people may update description and systemPrompt based on this instruction; do not rewrite personas for ordinary reused existing people.',
    `16. ${PROMPT_I18N.en.personaLanguageInstruction}`,
    '17. Write generated role names, descriptions, systemPrompt, node titles, instructions, and review criteria in English unless the user explicitly asks for another language.',
    '',
    'Available sites:',
    JSON.stringify([
      { value: 'chatgpt', label: 'ChatGPT' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'claude', label: 'Claude' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'grok', label: 'Grok' },
    ], null, 2),
    `Default site: ${input.store.settings.defaultChatSite}`,
    '',
    'Return JSON schema:',
    JSON.stringify({
      flowName: 'Workflow name',
      maxNodeExecutions: 30,
      roles: [
        {
          key: 'pm',
          reuseRoleId: 'Fill when reusing an existing person; otherwise omit',
          name: 'Product Manager',
          description: 'Person responsibility',
          systemPrompt: 'Persona prompt',
          preferredSite: 'chatgpt',
        },
      ],
      nodes: [
        {
          id: 'n1',
          kind: 'execute',
          roleKeys: ['pm'],
          title: 'Requirements breakdown',
          instruction: 'Specific task for this node',
        },
        {
          id: 'review',
          kind: 'review',
          roleKeys: ['reviewer'],
          title: 'Final review',
          instruction: 'Decide whether the result is deliverable',
          review: {
            criteria: 'Review criteria',
            maxAttempts: 3,
            onMaxAttempts: 'stop',
          },
        },
      ],
      edges: [
        { from: 'n1', to: 'review' },
        { from: 'review', to: 'n1', branch: 'fail' },
      ],
    }, null, 2),
    '',
    'Run task:',
    input.task,
    '',
    'This orchestration instruction:',
    input.instruction?.trim() || input.task,
    '',
    'existingRoles:',
    JSON.stringify(input.existingRoles.map(role => summarizeExistingRole(role, input.store)), null, 2),
    '',
    'currentFlow:',
    input.currentFlow ? JSON.stringify(summarizeCurrentFlow(input.currentFlow), null, 2) : 'none',
    '',
    'Auto orchestration history:',
    JSON.stringify(summarizeHistory(input.history ?? input.currentFlow?.autoPlanHistory ?? []), null, 2),
  ].join('\n')
}

export function buildAutoOrchestrationRepairPrompt(input: {
  task: string
  instruction?: string
  existingRoles: GroupRole[]
  currentFlow?: OrchestrationFlow
  history?: OrchestrationAutoPlanHistoryEntry[]
  store: OpenTeamStore
  invalidOutput: string
  error: string
}): string {
  const language = normalizeLanguage(input.store.settings.language)
  return [
    buildAutoOrchestrationPrompt(input),
    '',
    language === 'en' ? 'The previous output was invalid. Fix only the JSON. Do not explain.' : '上一次输出无效。请只修复 JSON，不要解释。',
    `${language === 'en' ? 'Error' : '错误'}：${input.error}`,
    '',
    language === 'en' ? 'Previous output:' : '上一次输出：',
    input.invalidOutput.slice(0, 12000),
  ].join('\n')
}

export function parseAutoOrchestrationPlan(text: string, existingRoleIds: Set<string>): AutoOrchestrationPlan {
  const parsed = JSON.parse(extractJsonObject(text))
  return normalizeAutoOrchestrationPlan(parsed, existingRoleIds)
}

export function normalizeAutoOrchestrationPlan(value: unknown, existingRoleIds: Set<string>): AutoOrchestrationPlan {
  if (!isRecord(value)) throw new Error('自动编排返回格式无效')
  const roles = normalizeRoles(value.roles, existingRoleIds)
  if (roles.length === 0) throw new Error('自动编排需要至少一个人员')
  const roleKeys = new Set(roles.map(role => role.key))
  const nodes = normalizeNodes(value.nodes, roleKeys)
  const edges = normalizeEdges(value.edges, new Set(nodes.map(node => node.id)), nodes)
  return serializeParallelRoleConflicts({
    flowName: readString(value.flowName, '自动编排流程'),
    maxNodeExecutions: normalizeMaxNodeExecutions(value.maxNodeExecutions),
    roles,
    nodes,
    edges: edges.length > 0 ? edges : sequentialEdges(nodes),
  })
}

function summarizeExistingRole(role: GroupRole, store: OpenTeamStore): Record<string, unknown> {
  return {
    id: role.id,
    name: role.name,
    createdBy: role.createdBy,
    site: role.modelSource === 'external'
      ? store.settings.externalModelsById[role.externalModelId ?? '']?.name ?? 'API'
      : role.chatSite ?? store.settings.defaultChatSite,
    description: role.description ?? '',
    systemPrompt: (role.systemPrompt ?? '').slice(0, 2000),
  }
}

function summarizeCurrentFlow(flow: OrchestrationFlow): Record<string, unknown> {
  return {
    id: flow.id,
    name: flow.name,
    task: flow.description ?? '',
    maxNodeExecutions: flow.maxNodeExecutions,
    nodes: (flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages).map(stage => ({
      id: stage.id,
      kind: stage.kind,
      name: stage.name,
      description: stage.description ?? '',
      roleIds: stage.roleIds,
      review: stage.review,
    })),
    edges: flow.graph?.edges ?? [],
  }
}

function summarizeHistory(history: OrchestrationAutoPlanHistoryEntry[]): OrchestrationAutoPlanHistoryEntry[] {
  return history.slice(-12).map(entry => ({
    id: entry.id,
    role: entry.role,
    content: entry.content.slice(0, 4000),
    createdAt: entry.createdAt,
  }))
}

function normalizeRoles(value: unknown, existingRoleIds: Set<string>): AutoOrchestrationRolePlan[] {
  if (!Array.isArray(value)) throw new Error('自动编排 roles 必须是数组')
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`roles[${index}] 格式无效`)
    const key = normalizeKey(item.key, `role${index + 1}`)
    if (seen.has(key)) throw new Error(`人员 key 重复：${key}`)
    seen.add(key)
    const reuseRoleId = readOptionalString(item.reuseRoleId)
    if (reuseRoleId && !existingRoleIds.has(reuseRoleId)) throw new Error(`reuseRoleId 不存在：${reuseRoleId}`)
    const name = readString(item.name, reuseRoleId ? key : '')
    if (!name) throw new Error(`roles[${index}] 缺少人员名称`)
    const preferredSite = readRoleChatSite(item)
    return {
      key,
      ...(reuseRoleId ? { reuseRoleId } : {}),
      name,
      description: readOptionalString(item.description),
      systemPrompt: readOptionalString(item.systemPrompt),
      preferredSite: preferredSite ?? DEFAULT_NEW_ROLE_SITE,
      ...(preferredSite ? { preferredSiteExplicit: true } : {}),
    }
  })
}

function normalizeNodes(value: unknown, roleKeys: Set<string>): AutoOrchestrationNodePlan[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('自动编排 nodes 必须是非空数组')
  if (value.length > MAX_AUTO_NODES) throw new Error(`自动编排节点不能超过 ${MAX_AUTO_NODES} 个`)
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`nodes[${index}] 格式无效`)
    const id = normalizeKey(item.id, `n${index + 1}`)
    if (seen.has(id)) throw new Error(`节点 id 重复：${id}`)
    seen.add(id)
    const roleKeysValue = Array.isArray(item.roleKeys) ? item.roleKeys : []
    if (roleKeysValue.length !== 1) throw new Error(`节点 ${id} 必须且只能有一个 roleKey`)
    const roleKey = normalizeKey(roleKeysValue[0], '')
    if (!roleKeys.has(roleKey)) throw new Error(`节点 ${id} 引用了不存在的 roleKey：${roleKey}`)
    const kind = item.kind === 'review' ? 'review' : 'execute'
    const review = kind === 'review' ? normalizeReview(item.review, item.instruction) : undefined
    return {
      id,
      kind,
      roleKey,
      title: readString(item.title, kind === 'review' ? '审核' : '执行'),
      instruction: readString(item.instruction, ''),
      ...(review ? { review } : {}),
    }
  })
}

function normalizeReview(value: unknown, fallbackCriteria: unknown): AutoOrchestrationReviewPlan {
  if (!isRecord(value)) throw new Error('审核节点必须包含 review 配置')
  return {
    criteria: readString(value.criteria, readString(fallbackCriteria, '判断结果是否满足任务目标')),
    maxAttempts: Math.min(50, Math.max(1, Math.trunc(readNumber(value.maxAttempts, 3)))),
    onMaxAttempts: value.onMaxAttempts === 'continue' ? 'continue' : 'stop',
  }
}

function normalizeEdges(value: unknown, nodeIds: Set<string>, nodes: AutoOrchestrationNodePlan[]): AutoOrchestrationEdgePlan[] {
  if (!Array.isArray(value)) return []
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  const result: AutoOrchestrationEdgePlan[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw new Error(`edges[${index}] 格式无效`)
    const from = normalizeKey(item.from, '')
    const to = normalizeKey(item.to, '')
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error(`连线引用了不存在的节点：${from} -> ${to}`)
    if (from === to) throw new Error(`连线不能连接自己：${from}`)
    const branch = item.branch === 'pass' || item.branch === 'fail' ? item.branch : undefined
    const source = byId.get(from)
    if (branch && source?.kind !== 'review') throw new Error(`只有审核节点可以使用 ${branch} 分支：${from}`)
    const key = `${from}:${branch ?? ''}->${to}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ from, to, ...(branch ? { branch } : {}) })
  }
  return result
}

function serializeParallelRoleConflicts(plan: AutoOrchestrationPlan): AutoOrchestrationPlan {
  const levels = graphLevels(plan.nodes, plan.edges)
  const extraEdges: AutoOrchestrationEdgePlan[] = []
  for (const level of new Set([...levels.values()])) {
    const nodes = plan.nodes.filter(node => levels.get(node.id) === level)
    const byRole = new Map<string, AutoOrchestrationNodePlan[]>()
    for (const node of nodes) byRole.set(node.roleKey, [...byRole.get(node.roleKey) ?? [], node])
    for (const roleNodes of byRole.values()) {
      if (roleNodes.length <= 1) continue
      for (let index = 0; index < roleNodes.length - 1; index += 1) {
        extraEdges.push({ from: roleNodes[index].id, to: roleNodes[index + 1].id })
      }
    }
  }
  return { ...plan, edges: uniqueEdges([...plan.edges, ...extraEdges]) }
}

function graphLevels(nodes: AutoOrchestrationNodePlan[], edges: AutoOrchestrationEdgePlan[]): Map<string, number> {
  const levels = new Map(nodes.map(node => [node.id, 0]))
  const outgoing = new Map<string, AutoOrchestrationEdgePlan[]>()
  const indegree = new Map(nodes.map(node => [node.id, 0]))
  for (const edge of edges.filter(edge => edge.branch !== 'fail')) {
    outgoing.set(edge.from, [...outgoing.get(edge.from) ?? [], edge])
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0)
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]
    const level = levels.get(node.id) ?? 0
    for (const edge of outgoing.get(node.id) ?? []) {
      levels.set(edge.to, Math.max(levels.get(edge.to) ?? 0, level + 1))
      indegree.set(edge.to, (indegree.get(edge.to) ?? 1) - 1)
      const target = nodes.find(item => item.id === edge.to)
      if (target && (indegree.get(edge.to) ?? 0) <= 0) queue.push(target)
    }
  }
  return levels
}

function sequentialEdges(nodes: AutoOrchestrationNodePlan[]): AutoOrchestrationEdgePlan[] {
  return nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }))
}

function uniqueEdges(edges: AutoOrchestrationEdgePlan[]): AutoOrchestrationEdgePlan[] {
  const seen = new Set<string>()
  const result: AutoOrchestrationEdgePlan[] = []
  for (const edge of edges) {
    const key = `${edge.from}:${edge.branch ?? ''}->${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced?.startsWith('{') && fenced.endsWith('}')) return fenced
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  throw new Error('自动编排没有返回 JSON')
}

function normalizeMaxNodeExecutions(value: unknown): number {
  return Math.min(200, Math.max(1, Math.trunc(readNumber(value, DEFAULT_AUTO_MAX_NODE_EXECUTIONS))))
}

function normalizeKey(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : fallback
  return raw.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readChatSite(value: unknown): ChatSite | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (normalized.includes('chatgpt') || normalized === 'gpt' || normalized === 'openai') return 'chatgpt'
  if (normalized.includes('claude') || normalized === 'anthropic') return 'claude'
  if (normalized.includes('gemini') || normalized === 'google') return 'gemini'
  if (normalized.includes('deepseek')) return 'deepseek'
  if (normalized.includes('grok') || normalized.includes('xai')) return 'grok'
  if (normalized.includes('qwen') || normalized.includes('千问')) return 'qwen'
  return undefined
}

function readRoleChatSite(item: Record<string, unknown>): ChatSite | undefined {
  const candidates = [
    item.preferredSite,
    item.preferred_site,
    item.chatSite,
    item.chat_site,
    item.site,
    item.modelSite,
    item.model_site,
    item.provider,
    item.modelProvider,
    item['站点'],
  ]
  for (const candidate of candidates) {
    const site = readChatSite(candidate)
    if (site) return site
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
