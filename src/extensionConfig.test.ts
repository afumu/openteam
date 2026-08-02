import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertCompliantReleaseScript,
  collectJavaScriptFiles,
  createEsbuildScriptHardeningOptions,
  createViteBuildHardeningOptions,
  hasTopLevelStaticImport,
} from '../vite.config'

describe('extension security configuration', () => {
  it('pins the unpacked extension id with a stable manifest key', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      key?: string
    }

    expect(manifest.key).toBeDefined()
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(extensionIdFromManifestKey(manifest.key!)).toBe('cnccbifloajlkjglmiojkpimjciamlpe')
  })

  it('scopes host permissions to supported AI chat sites and external API origins', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      host_permissions?: string[]
    }

    expect(manifest.host_permissions).toEqual([
      'https://gemini.google.com/*',
      'https://*.gemini.google.com/*',
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://chat.deepseek.com/*',
      'https://grok.com/*',
      'https://*.grok.com/*',
      'https://*/*',
      'http://*/*',
    ])
    expect(manifest.host_permissions).not.toContain('<all_urls>')
  })

  it('does not declare page-world bridge scripts in release manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{
        matches?: string[]
        js?: string[]
        world?: string
      }>
    }

    const scripts = manifest.content_scripts ?? []
    expect(scripts.flatMap(script => script.js ?? []).some(script => script.endsWith('PageWorldBridge.js'))).toBe(false)
    expect(scripts.some(script => script.world === 'MAIN')).toBe(false)
  })

  it('allows extension pages to connect to the local OpenTeam control daemon', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      content_security_policy?: {
        extension_pages?: string
      }
    }

    expect(manifest.content_security_policy?.extension_pages).toContain('connect-src')
    expect(manifest.content_security_policy?.extension_pages).toContain('ws://127.0.0.1:*')
    expect(manifest.content_security_policy?.extension_pages).toContain('http://127.0.0.1:*')
  })

  it('allows background alarms for local control reconnection checks', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
      permissions?: string[]
    }

    expect(manifest.permissions).toContain('alarms')
    expect(manifest.permissions).toContain('unlimitedStorage')
  })

  it('limits iframe header overrides to supported AI chat subframes', () => {
    const rules = JSON.parse(readFileSync(resolve(process.cwd(), 'public/openteam-frame-rules.json'), 'utf8')) as Array<{
      condition?: {
        urlFilter?: string
        resourceTypes?: string[]
      }
    }>

    expect(rules).toHaveLength(6)
    expect(rules.map(rule => rule.condition?.urlFilter)).toEqual([
      '||gemini.google.com/',
      '||chatgpt.com/',
      '||chat.openai.com/',
      '||claude.ai/',
      '||chat.deepseek.com/',
      '||grok.com/',
    ])

    for (const rule of rules) {
      expect(rule.condition?.resourceTypes).toEqual(['sub_frame'])
      expect(rule.condition?.urlFilter).not.toBe('*://*/*')
      expect(rule.condition?.resourceTypes).not.toContain('main_frame')
    }
  })

  it('detects compact static imports in content script output', () => {
    expect(hasTopLevelStaticImport('import{c as createLogger}from"./assets/logger.js";')).toBe(true)
    expect(hasTopLevelStaticImport('(() => { console.log("bundled") })();')).toBe(false)
  })

  it('keeps development builds readable and production builds minified without sourcemaps', () => {
    expect(createViteBuildHardeningOptions('development')).toEqual({
      minify: false,
      sourcemap: false,
    })

    expect(createViteBuildHardeningOptions('production')).toEqual({
      minify: 'esbuild',
      sourcemap: false,
    })
  })

  it('applies the same compliant minification policy to esbuild-only extension scripts', () => {
    expect(createEsbuildScriptHardeningOptions('development')).toEqual({
      minify: false,
      sourcemap: false,
      legalComments: 'none',
    })

    expect(createEsbuildScriptHardeningOptions('production')).toEqual({
      minify: true,
      sourcemap: false,
      legalComments: 'none',
    })
  })

  it('rejects release script artifacts that expose sourcemaps or dynamic execution primitives', () => {
    expect(() => assertCompliantReleaseScript('content.js', '(() => console.log("ok"))();')).not.toThrow()
    expect(() => assertCompliantReleaseScript('content.js', 'import{a}from"./chunk.js";')).toThrow(/self-contained/)
    expect(() => assertCompliantReleaseScript('team.js', 'console.log("ok");\n//# sourceMappingURL=team.js.map')).toThrow(/source map/)
    expect(() => assertCompliantReleaseScript('team.js', 'eval("alert(1)")')).toThrow(/dynamic code execution/)
    expect(() => assertCompliantReleaseScript('team.js', 'new Function("return 1")')).toThrow(/dynamic code execution/)
  })

  it('collects nested release JavaScript chunks for compliance scanning', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'openteam-release-js-'))
    mkdirSync(resolve(root, 'assets'))
    writeFileSync(resolve(root, 'team.js'), 'console.log("team")')
    writeFileSync(resolve(root, 'assets', 'chunk.js'), 'console.log("chunk")')
    writeFileSync(resolve(root, 'team.css'), '.app{}')

    try {
      expect(collectJavaScriptFiles(root).map(file => file.replace(root, '<root>').replace(/\\/g, '/')).sort()).toEqual([
        '<root>/assets/chunk.js',
        '<root>/team.js',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function extensionIdFromManifestKey(key: string): string {
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest()
  return Array.from(hash.subarray(0, 16))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, value => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(value, 16)))
}
