/// <reference types="vitest" />
import { configDefaults, defineConfig } from 'vitest/config'
import { build as buildWithEsbuild } from 'esbuild'
import { join, resolve } from 'path'
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'fs'

export function hasTopLevelStaticImport(source: string): boolean {
  return /^\s*import(?:[\s{*"']|\w)/m.test(source)
}

export function createViteBuildHardeningOptions(mode: string): { minify: false | 'esbuild'; sourcemap: false } {
  return {
    minify: mode === 'development' ? false : 'esbuild',
    sourcemap: false,
  }
}

export function createEsbuildScriptHardeningOptions(mode: string): { minify: boolean; sourcemap: false; legalComments: 'none' } {
  return {
    minify: mode !== 'development',
    sourcemap: false,
    legalComments: 'none',
  }
}

function mustBeSelfContainedScript(fileName: string): boolean {
  return /(?:content|PageWorldBridge)\.js$/.test(fileName)
}

export function assertCompliantReleaseScript(fileName: string, source: string): void {
  if (mustBeSelfContainedScript(fileName) && hasTopLevelStaticImport(source)) {
    throw new Error(`${fileName} must be self-contained because Chrome content_scripts are not ES modules`)
  }
  if (/(?:sourceMappingURL|sourceURL)=/.test(source)) {
    throw new Error(`${fileName} must not expose a source map reference in release builds`)
  }
  if (/\beval\s*\(|\b(?:new\s+)?Function\s*\(/.test(source)) {
    throw new Error(`${fileName} must not use dynamic code execution in release builds`)
  }
}

export function collectJavaScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath)
    }
  }
  return files
}

export default defineConfig(({ mode }) => ({
  define: {
    __OPENTEAM_DEV__: JSON.stringify(mode === 'development'),
  },
  plugins: [
    {
      name: 'strip-cli-hashbang',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('.mjs') || !code.startsWith('#!')) return undefined
        const newline = code.indexOf('\n')
        return newline === -1 ? '' : code.slice(newline + 1)
      },
    },
    {
      name: 'safe-lodash-global-root',
      transform(source, id) {
        if (!id.endsWith('/lodash-es/_root.js')) return undefined
        return source.replace("Function('return this')()", 'globalThis')
      },
    },
    {
      name: 'extension-files',
      apply: 'build',
      async closeBundle() {
        mkdirSync('dist', { recursive: true })
        copyFileSync('public/manifest.json', 'dist/manifest.json')
        const esbuildHardeningOptions = createEsbuildScriptHardeningOptions(mode)

        await buildWithEsbuild({
          entryPoints: [resolve(__dirname, 'src/content/index.ts')],
          outfile: resolve(__dirname, 'dist/content.js'),
          bundle: true,
          format: 'iife',
          platform: 'browser',
          target: 'chrome114',
          define: {
            __OPENTEAM_DEV__: JSON.stringify(mode === 'development'),
          },
          ...esbuildHardeningOptions,
        })

        for (const scriptPath of collectJavaScriptFiles('dist')) {
          assertCompliantReleaseScript(scriptPath, readFileSync(scriptPath, 'utf8'))
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    ...createViteBuildHardeningOptions(mode),
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        team: resolve(__dirname, 'src/teamPage/index.ts')
      },
      output: {
        entryFileNames: '[name].js'
      }
    }
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
  }
}))
