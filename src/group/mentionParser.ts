import type { GroupChat, GroupRole, OpenTeamSettings } from './types'

type OrchestrationMentionTarget = 'default' | { name: string }

export type ParsedGroupMention =
  | {
      ok: true
      content: string
      targetRoleIds: string[]
      mentionedRoleIds: string[]
      mentionsAll?: true
      orchestrationTarget?: OrchestrationMentionTarget
    }
  | {
      ok: false
      error: string
    }

export interface RoleMentionLabelOptions {
  defaultChatSite?: GroupRole['chatSite']
  externalModelNamesById?: Record<string, string>
}

export interface ParseGroupMentionsOptions extends RoleMentionLabelOptions {
  defaultTarget?: 'all' | 'none'
}

export function defaultMentionTargetForMessage(raw: string, chat: Pick<GroupChat, 'mode' | 'requireManualMention'>): 'all' | 'none' {
  if (chat.mode !== 'collaborative') return 'none'
  if (chat.requireManualMention !== false) return 'none'
  if (raw.includes('@')) return 'none'
  return 'all'
}

export function parseGroupMentions(raw: string, roles: GroupRole[], options: ParseGroupMentionsOptions = {}): ParsedGroupMention {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: '消息内容不能为空' }

  const allRoleIds = roles.map(role => role.id)
  if (!trimmed.includes('@')) {
    return { ok: true, content: trimmed, targetRoleIds: defaultTargetRoleIds(allRoleIds, options), mentionedRoleIds: [] }
  }

  const mentionTargets = roles.flatMap(role => [
    { role, label: roleMentionLabel(role, options) },
    { role, label: role.name },
  ]).sort((left, right) => right.label.length - left.label.length)
  const targetRoleIds = new Set<string>()
  let targetsAll = false
  let orchestrationTarget: OrchestrationMentionTarget | undefined
  let content = ''
  let index = 0

  while (index < trimmed.length) {
    if (trimmed[index] !== '@') {
      content += trimmed[index]
      index += 1
      continue
    }

    const orchestrationMention = readOrchestrationMention(trimmed, index)
    if (orchestrationMention) {
      orchestrationTarget = orchestrationMention.target
      index = orchestrationMention.nextIndex
      continue
    }

    const allMentionLabel = ['all', '所有人'].find(label => mentionMatches(trimmed, index, label))
    if (allMentionLabel) {
      targetsAll = true
      index += allMentionLabel.length + 1
      continue
    }

    const target = mentionTargets.find(candidate => mentionMatches(trimmed, index, candidate.label))
    if (!target) {
      content += trimmed[index]
      index += 1
      continue
    }

    targetRoleIds.add(target.role.id)
    index += target.label.length + 1
  }

  const parsedContent = compactContent(content)
  if (!parsedContent) return { ok: false, error: '消息内容不能为空' }

  return {
    ok: true,
    content: parsedContent,
    targetRoleIds: targetsAll ? allRoleIds : targetRoleIds.size > 0 ? [...targetRoleIds] : defaultTargetRoleIds(allRoleIds, options),
    mentionedRoleIds: [...targetRoleIds],
    ...(targetsAll ? { mentionsAll: true as const } : {}),
    ...(orchestrationTarget ? { orchestrationTarget } : {}),
  }
}

export function roleMentionLabel(role: GroupRole, options: RoleMentionLabelOptions = {}): string {
  return `${role.name}（${roleModelLabel(role, options)}）`
}

export function roleModelLabel(role: GroupRole, options: RoleMentionLabelOptions = {}): string {
  if (role.modelSource === 'external') {
    const externalName = role.externalModelId ? options.externalModelNamesById?.[role.externalModelId]?.trim() : undefined
    return externalName || 'API'
  }
  return siteLabel(role.chatSite ?? options.defaultChatSite)
}

export function roleMentionLabelOptionsFromSettings(settings: Pick<OpenTeamSettings, 'defaultChatSite' | 'externalModelsById'>): RoleMentionLabelOptions {
  return {
    defaultChatSite: settings.defaultChatSite,
    externalModelNamesById: Object.fromEntries(Object.entries(settings.externalModelsById).map(([modelId, model]) => [modelId, model.name])),
  }
}

function siteLabel(site: GroupRole['chatSite']): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  if (site === 'qwen') return 'Qwen'
  return 'Gemini'
}

function mentionMatches(raw: string, atIndex: number, target: string): boolean {
  if (!raw.startsWith(`@${target}`, atIndex)) return false
  const next = raw[atIndex + target.length + 1]
  return next === undefined || isMentionBoundary(next)
}

function readOrchestrationMention(raw: string, atIndex: number): { target: OrchestrationMentionTarget; nextIndex: number } | undefined {
  for (const label of ['编排', 'orchestration']) {
    if (!raw.startsWith(`@${label}`, atIndex)) continue
    const nextIndex = atIndex + label.length + 1
    const afterLabel = raw.slice(nextIndex)
    if (afterLabel.startsWith(':') || afterLabel.startsWith('：')) {
      const name = afterLabel.slice(1).match(/^([^\s，。！？,.!?;；:：]+)/)?.[1]
      if (!name) return undefined
      return { target: { name }, nextIndex: nextIndex + 1 + name.length }
    }
    const next = raw[nextIndex]
    if (next === undefined || isMentionBoundary(next)) return { target: 'default', nextIndex }
  }
}

function isMentionBoundary(value: string): boolean {
  return /\s|[，。！？,.!?;；:：]/.test(value)
}

function defaultTargetRoleIds(allRoleIds: string[], options: ParseGroupMentionsOptions): string[] {
  return options.defaultTarget === 'none' ? [] : allRoleIds
}

function compactContent(raw: string): string {
  return raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
