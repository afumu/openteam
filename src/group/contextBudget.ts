import type { ChatSite, ExternalModelConfig, GroupRole, OpenTeamStore } from './types'

export const CONTEXT_CHAR_BUDGET_BY_SITE: Record<ChatSite, number> = {
  gemini: 1_000_000,
  chatgpt: 272_000,
  claude: 500_000,
  deepseek: 1_000_000,
  grok: 256_000,
  qwen: 1_000_000,
}

export function contextCharBudgetForRole(store: OpenTeamStore, role: GroupRole): number {
  const configuredBudget = normalizedConfiguredBudget(store.settings.maxContextChars)
  const modelBudget = role.modelSource === 'external'
    ? contextCharBudgetForExternalModel(store.settings.externalModelsById[role.externalModelId ?? ''])
    : CONTEXT_CHAR_BUDGET_BY_SITE[role.chatSite ?? store.settings.defaultChatSite]
  return Math.max(configuredBudget, modelBudget ?? configuredBudget)
}

function contextCharBudgetForExternalModel(model: ExternalModelConfig | undefined): number | undefined {
  if (!model) return undefined
  const modelName = model.modelName.toLowerCase()
  const providerName = model.name.toLowerCase()
  const label = `${providerName} ${modelName}`
  if (label.includes('gemini')) return CONTEXT_CHAR_BUDGET_BY_SITE.gemini
  if (label.includes('deepseek')) return CONTEXT_CHAR_BUDGET_BY_SITE.deepseek
  if (label.includes('grok') || label.includes('xai')) return CONTEXT_CHAR_BUDGET_BY_SITE.grok
  if (label.includes('qwen') || label.includes('千问')) return CONTEXT_CHAR_BUDGET_BY_SITE.qwen
  if (label.includes('claude') || label.includes('anthropic')) return 1_000_000
  if (label.includes('gpt') || label.includes('openai') || label.includes('o3') || label.includes('o4')) return CONTEXT_CHAR_BUDGET_BY_SITE.chatgpt
  return undefined
}

function normalizedConfiguredBudget(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
