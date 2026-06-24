import { afterEach, describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PORT, createControlDaemon } from './openteam-daemon.mjs'

describe('openteam local daemon', () => {
  const daemons = []
  const servers = []
  const tempDirs = []

  afterEach(async () => {
    await Promise.all(daemons.map(daemon => daemon.close()))
    await Promise.all(servers.map(server => closeServer(server)))
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    daemons.length = 0
    servers.length = 0
    tempDirs.length = 0
  })

  it('uses the shared OpenTeam control default port', () => {
    expect(DEFAULT_PORT).toBe(19305)
  })

  it('forwards authenticated HTTP commands to the connected extension WebSocket', async () => {
    const daemon = await createControlDaemon({ port: 0, token: 'test-token', logToConsole: false })
    daemons.push(daemon)
    const extension = new WebSocket(`ws://127.0.0.1:${daemon.port}/ext?profileId=test-profile`)
    const commands = []
    extension.addEventListener('open', () => {
      extension.send(JSON.stringify({
        type: 'hello',
        extensionVersion: '1.0.0',
        protocolVersion: 1,
        profileId: 'test-profile',
        capabilities: ['chat.list'],
      }))
    })
    extension.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.type !== 'command') return
      commands.push(message.command)
      extension.send(JSON.stringify({
        type: 'result',
        result: {
          id: message.command.id,
          ok: true,
          data: { chats: [{ id: 'chat-1', name: '评审群' }] },
        },
      }))
    })
    await waitFor(() => daemon.status().extensionConnected)

    const response = await fetch(`http://127.0.0.1:${daemon.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenTeam': '1',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ id: 'cmd-1', action: 'chat.list' }),
    })

    await expect(response.json()).resolves.toEqual({
      id: 'cmd-1',
      ok: true,
      data: { chats: [{ id: 'chat-1', name: '评审群' }] },
    })
    expect(commands).toEqual([{ id: 'cmd-1', action: 'chat.list' }])
    extension.close()
  })

  it('rejects commands when the bearer token is missing', async () => {
    const daemon = await createControlDaemon({ port: 0, token: 'test-token', logToConsole: false })
    daemons.push(daemon)

    const response = await fetch(`http://127.0.0.1:${daemon.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenTeam': '1' },
      body: JSON.stringify({ id: 'cmd-1', action: 'chat.list' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'permission_denied' },
    })
  })

  it('accepts fragmented extension WebSocket messages', async () => {
    const daemon = await createControlDaemon({ port: 0, token: 'test-token', logToConsole: false })
    daemons.push(daemon)
    const socket = await openRawWebSocket(daemon.port, '/ext?profileId=test-profile')
    const hello = JSON.stringify({
      type: 'hello',
      extensionVersion: '1.0.0',
      protocolVersion: 1,
      profileId: 'test-profile',
      capabilities: ['chat.list'],
    })

    socket.write(clientFrame(hello.slice(0, 31), 1, false))
    socket.write(clientFrame(hello.slice(31), 0, true))

    await waitFor(() => daemon.status().extensionVersion === '1.0.0')
    expect(daemon.status()).toMatchObject({
      extensionConnected: true,
      extensionVersion: '1.0.0',
      protocolVersion: 1,
      profiles: [expect.objectContaining({ profileId: 'test-profile' })],
    })
    socket.destroy()
  })

  it('lists configured ACP agents without requiring an extension connection', async () => {
    const daemon = await createControlDaemon({
      port: 0,
      token: 'test-token',
      logToConsole: false,
      acpAgents: [{
        id: 'opencode',
        name: 'OpenCode',
        type: 'websocket',
        url: 'ws://127.0.0.1:3030',
        enabled: true,
        cwdAllowlist: [process.cwd()],
      }],
    })
    daemons.push(daemon)

    const response = await authenticatedCommand(daemon, {
      id: 'cmd-agent-list',
      action: 'agent.list',
    })

    await expect(response.json()).resolves.toEqual({
      id: 'cmd-agent-list',
      ok: true,
      data: {
        agents: [{
          id: 'opencode',
          name: 'OpenCode',
          type: 'websocket',
          enabled: true,
          cwdAllowlist: [process.cwd()],
        }],
        capabilities: ['agent.list', 'agent.run', 'agent.cancel', 'agent.read'],
      },
    })
  })

  it('loads ACP agent configuration from a JSON file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'openteam-acp-config-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'acp-agents.json')
    writeFileSync(configPath, JSON.stringify({
      agents: [{
        id: 'configured-agent',
        name: 'Configured Agent',
        type: 'websocket',
        url: 'ws://127.0.0.1:3030',
        enabled: true,
        cwdAllowlist: [process.cwd()],
      }],
    }))
    const daemon = await createControlDaemon({
      port: 0,
      token: 'test-token',
      logToConsole: false,
      agentConfigPath: configPath,
    })
    daemons.push(daemon)

    const response = await authenticatedCommand(daemon, {
      id: 'cmd-agent-list',
      action: 'agent.list',
    })

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        agents: [{
          id: 'configured-agent',
          name: 'Configured Agent',
        }],
      },
    })
  })

  it('runs a configured WebSocket ACP agent through JSON-RPC', async () => {
    const acp = await createMockAcpServer(message => ({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: 'done from acp' }] },
    }))
    servers.push(acp.server)
    const daemon = await createControlDaemon({
      port: 0,
      token: 'test-token',
      logToConsole: false,
      acpAgents: [{
        id: 'opencode',
        name: 'OpenCode',
        type: 'websocket',
        url: `ws://127.0.0.1:${acp.port}`,
        enabled: true,
        cwdAllowlist: [process.cwd()],
      }],
    })
    daemons.push(daemon)

    const response = await authenticatedCommand(daemon, {
      id: 'cmd-agent-run',
      action: 'agent.run',
      payload: {
        agentId: 'opencode',
        prompt: 'Please inspect the repo',
        cwd: process.cwd(),
      },
    })

    await expect(response.json()).resolves.toMatchObject({
      id: 'cmd-agent-run',
      ok: true,
      data: {
        run: {
          id: expect.any(String),
          agentId: 'opencode',
          status: 'completed',
          cwd: process.cwd(),
          output: 'done from acp',
          result: { content: [{ type: 'text', text: 'done from acp' }] },
        },
      },
    })
    expect(acp.messages).toEqual([{
      jsonrpc: '2.0',
      id: expect.any(String),
      method: 'session/prompt',
      params: {
        prompt: 'Please inspect the repo',
        cwd: process.cwd(),
      },
    }])
  })

  it('rejects ACP runs outside the configured workspace allowlist', async () => {
    const daemon = await createControlDaemon({
      port: 0,
      token: 'test-token',
      logToConsole: false,
      acpAgents: [{
        id: 'opencode',
        name: 'OpenCode',
        type: 'websocket',
        url: 'ws://127.0.0.1:3030',
        enabled: true,
        cwdAllowlist: [process.cwd()],
      }],
    })
    daemons.push(daemon)

    const response = await authenticatedCommand(daemon, {
      id: 'cmd-agent-run',
      action: 'agent.run',
      payload: {
        agentId: 'opencode',
        prompt: 'Please inspect /etc',
        cwd: '/etc',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      id: 'cmd-agent-run',
      ok: false,
      error: {
        code: 'workspace_not_allowed',
      },
    })
  })
})

function authenticatedCommand(daemon, body) {
  return fetch(`http://127.0.0.1:${daemon.port}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenTeam': '1',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  })
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('waitFor timed out')
}

function openRawWebSocket(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })
    let response = ''
    socket.on('data', chunk => {
      response += chunk.toString('utf8')
      if (!response.includes('\r\n\r\n')) return
      socket.off('error', reject)
      resolve(socket)
    })
  })
}

function clientFrame(data, opcode, fin) {
  const payload = Buffer.from(data)
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  const length = payload.length
  const header = length < 126
    ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | length])
    : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, length >> 8, length & 0xff])
  const masked = Buffer.from(payload)
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4]
  return Buffer.concat([header, mask, masked])
}

async function createMockAcpServer(reply) {
  const messages = []
  const sockets = new Set()
  const server = createServer()
  server.__sockets = sockets
  server.on('upgrade', (request, socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${webSocketAcceptKey(key)}`,
      '',
      '',
    ].join('\r\n'))
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      buffer = readServerFrames(buffer, frame => {
        if (frame.opcode === 8) {
          socket.end()
          return
        }
        if (frame.opcode !== 1) return
        const message = JSON.parse(frame.payload.toString('utf8'))
        messages.push(message)
        socket.write(serverFrame(JSON.stringify(reply(message))))
      })
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen(undefined)
    })
  })
  return {
    server,
    messages,
    port: server.address().port,
  }
}

function webSocketAcceptKey(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
}

function closeServer(server) {
  if (server.__sockets) {
    for (const socket of server.__sockets) socket.destroy()
    server.__sockets.clear()
  }
  return new Promise(resolve => server.close(() => resolve(undefined)))
}

function readServerFrames(buffer, onFrame) {
  let offset = 0
  while (buffer.length - offset >= 2) {
    const first = buffer[offset]
    const second = buffer[offset + 1]
    const fin = Boolean(first & 0x80)
    const opcode = first & 0x0f
    const masked = Boolean(second & 0x80)
    let length = second & 0x7f
    let headerLength = 2
    if (length === 126) {
      if (buffer.length - offset < 4) break
      length = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    }
    const maskLength = masked ? 4 : 0
    const frameLength = headerLength + maskLength + length
    if (buffer.length - offset < frameLength) break
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : undefined
    const payloadStart = offset + headerLength + maskLength
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length))
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
    }
    onFrame({ fin, opcode, payload })
    offset += frameLength
  }
  return buffer.subarray(offset)
}

function serverFrame(data) {
  const payload = Buffer.from(data)
  return payload.length < 126
    ? Buffer.concat([Buffer.from([0x81, payload.length]), payload])
    : Buffer.concat([Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]), payload])
}
