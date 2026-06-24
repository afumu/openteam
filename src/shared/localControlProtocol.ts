export const OPENTEAM_CONTROL_PROTOCOL_VERSION = 1
export const OPENTEAM_CONTROL_DEFAULT_PORT = 19305
export const OPENTEAM_CONTROL_LEGACY_DEFAULT_PORT = 19826

export type OpenTeamControlConnectionState = 'disabled' | 'connecting' | 'connected' | 'disconnected'

export interface OpenTeamControlConnectionStatus {
  state: OpenTeamControlConnectionState
  port: number
  url?: string
  lastError?: string
}

export const OPENTEAM_CONTROL_CAPABILITIES = [
  'store.get',
  'chat.list',
  'chat.get',
  'chat.create',
  'chat.activate',
  'chat.initialize',
  'roles.batchAdd',
  'task.post',
  'task.wait',
  'task.read',
  'run.createAndPost',
  'agent.list',
  'agent.run',
  'agent.cancel',
  'agent.read',
] as const

export type OpenTeamControlCapability = typeof OPENTEAM_CONTROL_CAPABILITIES[number]

export interface ControlHttpCommand {
  id: string
  action: string
  payload?: unknown
  timeoutMs?: number
  profileId?: string
}

export interface ControlHttpResult {
  id: string
  ok: boolean
  data?: unknown
  error?: ControlErrorPayload
}

export interface ControlErrorPayload {
  code: string
  message: string
  hint?: string
  recoverable?: boolean
}

export interface ExtensionHello {
  type: 'hello'
  extensionVersion: string
  protocolVersion: typeof OPENTEAM_CONTROL_PROTOCOL_VERSION
  profileId: string
  capabilities: OpenTeamControlCapability[]
}

export type ExtensionControlMessage =
  | ExtensionHello
  | { type: 'result'; result: ControlHttpResult }

export type DaemonControlMessage =
  | { type: 'command'; command: ControlHttpCommand }

export function controlSuccess(id: string, data?: unknown): ControlHttpResult {
  return { id, ok: true, ...(data === undefined ? {} : { data }) }
}

export function controlFailure(id: string, code: string, message: string, options: Pick<ControlErrorPayload, 'hint' | 'recoverable'> = {}): ControlHttpResult {
  return {
    id,
    ok: false,
    error: {
      code,
      message,
      ...options,
    },
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
