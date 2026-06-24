import { describe, expect, it } from 'vitest'
import { OPENTEAM_CONTROL_CAPABILITIES } from './localControlProtocol'

describe('local control protocol capabilities', () => {
  it('advertises ACP local agent control commands', () => {
    expect(OPENTEAM_CONTROL_CAPABILITIES).toEqual(expect.arrayContaining([
      'agent.list',
      'agent.run',
      'agent.cancel',
      'agent.read',
    ]))
  })
})
