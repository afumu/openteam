# 新增 AI 聊天站点适配器

## 概述

OpenTeam 通过 `ChatSiteAdapter` 接口与各 AI 聊天网站交互。每个站点有独立的适配器文件，通过 hostname 路由分发。新增站点需要：新建适配器、新建测试、注册路由、更新 manifest。

## 核心接口

```typescript
// src/content/sites/types.ts
interface ChatSiteAdapter {
  readonly id: string                                    // 唯一标识，如 'qwen'
  getConversationSnapshot(): ConversationSnapshot        // 解析当前对话 URL 和 ID
  getConversationId(): string                            // 取对话 ID，默认 '__default__'
  getResponseContainers(): Element[]                     // 查找所有回复容器
  getAllAssistantReplies(): string[]                     // 提取所有回复文本
  readResponseText(node: Node): string                   // 从单个节点提取纯文本
  readResponseTextFromCopy?(node: Node): Promise<string | undefined>  // 可选：通过复制按钮获取文本
  readResponseMarkdown?(node: Node): string              // 可选：提取 markdown（保留格式）
  findResponseContainer(element: Element | null): Element | null  // 从任意元素找所属回复容器
  isGenerating(): boolean                                // 是否正在生成回复
  stopGenerating(): Promise<boolean>                     // 停止生成
  fillAndSend(content: string, autoSend?: boolean): Promise<void>  // 填充输入框并发消息
  collectPromptDiagnostics(): Record<string, unknown>    // 收集诊断信息
}
```

## 需要修改/新建的文件

| 操作 | 文件 |
|------|------|
| **新建** | `src/content/sites/{site}.ts` |
| **新建** | `src/content/sites/{site}.test.ts` |
| **修改** | `src/content/sites/index.ts` |
| **修改** | `public/manifest.json` |

## 修改步骤

### 1. 新建适配器 `src/content/sites/{site}.ts`

参考 `src/content/sites/qwen.ts`（同步模式 + 注入了 `stripNonContentElements`）或 `src/content/sites/grok.ts`（异步编辑器等待 + clipboard 回退）。推荐基于 qwen.ts 结构，因为它是最近新增的适配器，结构最清晰。

**需要确定的关键 DOM 选择器：**

- `editor` — 输入框（textarea / contenteditable）
- `sendButton` — 发送按钮
- `response` — AI 回复容器
- `copyButton` — 复制按钮（可选）
- `stopButton` — 停止生成按钮
- 对话 URL 路径格式（用于提取 conversationId）

**必须实现的函数：**

```typescript
// 1. URL 解析
export function get{site}ConversationLocation(href: string): ConversationSnapshot
function parseSafe{site}Url(value: string | undefined): URL | undefined
function extractConversationId(url: URL): string | undefined

// 2. 编辑器操作
async function fillAndSend(content: string, autoSend: boolean): Promise<void>
function setEditorText(editor, content): void

// 3. 回复读取
function getResponseContainers(): Element[]
function getAllAssistantReplies(): string[]
function extractCleanText(node: Node): string
function stripNonContentElements(node: Node): Node  // 如有需要清洗的 DOM

// 4. 生成状态
function isGenerating(): boolean
async function stopGenerating(): Promise<boolean>

// 5. 诊断
function collectPromptDiagnostics(): Record<string, unknown>
```

### 2. 新建测试 `src/content/sites/{site}.test.ts`

```typescript
// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { create{site}Adapter } from './{site}'

describe('{Site} site adapter', () => {
  // URL 解析（3-4 个用例）
  it('extracts conversation ids and normalized safe urls')
  it('does not report non-{site} urls')
  it('returns default conversation id on the home page')

  // 编辑器和发送（3-4 个用例）
  it('writes prompt text into editor')
  it('waits for a clickable send button before clicking')
  it('does not click a disabled send button')

  // 回复读取（5-6 个用例）
  it('detects when no conversation messages exist')
  it('reads assistant replies')
  it('ignores user messages when reading assistant replies')
  it('excludes status/thinking cards from replies')
  it('excludes footer/copy buttons from replies')
  it('strips hyperlinks/citations from replies')
  it('converts DOM to markdown preserving bold formatting')

  // 停止生成（3 个用例）
  it('does not report generation when no stop button')
  it('detects stop button as active generation')
  it('stops generation by clicking stop button')
})
```

### 3. 注册路由 `src/content/sites/index.ts`

添加 import 和 hostname 判断：

```typescript
import { create{site}Adapter } from './{site}'

export function getActiveChatSiteAdapter(): ChatSiteAdapter {
  if (location.hostname === '{host}') return create{site}Adapter()
  // ... 其他站点 ...
}
```

### 4. 更新 `public/manifest.json`

三处修改（参考 qwen 的添加方式）：

**host_permissions：**
```json
"https://{host}/*",
"https://*.{host}/*",   // 如有子域名
```

**content_security_policy.extension_pages 的 frame-src：**
```json
"frame-src ... https://{host} https://*.{host}"
```

**content_scripts[0].matches：**
```json
"*://{host}/*",
"*://*.{host}/*",       // 如有子域名
```

## 可用工具函数

| 路径 | 用途 |
|------|------|
| `src/content/sites/waitForElement.ts` | `waitForElement(selectors, timeoutMs)` — 轮询等待 DOM 元素出现 |
| `src/content/sites/domText.ts` | `extractCleanTextFromDom(node, { skipTags })` — 从 DOM 提取纯文本；`findClosestMatchingAncestor()` — 向上查找匹配祖先；`buttonLabelMatches()` — 按钮文本匹配；`describeElement()` — 元素诊断信息 |
| `src/content/sites/domMarkdown.ts` | `extractMarkdownFromDom(node)` — 将 DOM 转为 markdown（支持 `##`, `**`, `*`, `\``, `>`, 列表、表格） |
| `src/content/sites/clipboardCopy.ts` | `readResponseTextFromCopyAction()` — 通过点击复制按钮 + 监听剪贴板获取文本 |
| `src/content/sites/contentEditable.ts` | `setContentEditableText()` / `readEditorText()` — 操作 contenteditable 编辑器 |
| `src/content/responseContainers.ts` | `keepDeepestResponseContainers()` — 去重：当多个选择器匹配到嵌套容器时只保留最深层的 |

## 常见问题排查

### 编辑器操作
- **React 控制组件**：不能直接 `editor.value = text`，需要用 `Object.getOwnPropertyDescriptor` 的原生 setter
- **React 覆盖 getter**：写入后的值检查也要用原生 getter，否则 React 返回旧值
- **发送按钮不可点击**：写入后等待 50-100ms 让 React 处理 input 事件再找发送按钮
- **contenteditable**：用 `document.execCommand` 或 `setContentEditableText`，不能用 value 属性

### 回复读取
- **DOM 结构**：先用 DevTools 确认站点实际选类名，不必和 <p>/<h1> 等标准标签匹配
- **只取 assistant 回复**：需过滤掉 `.user-message`、`form`、`textarea`、`[contenteditable]` 等用户区域
- **状态卡片过滤**：如果站点在回复中混入"正在搜索/思考"等状态提示，在 `stripNonContentElements` 中移除
- **引用/超链接**：大多数 AI 站点的引用链接应在提取结果中移除

### Markdown（通过 `domMarkdown.ts`）
- `domMarkdown.ts` 的 `block()` 默认只识别 `<p>`、`<h1-6>`、`<blockquote>`、列表等标准块级标签
- 如果站点使用 `<div class="xxx-paragraph">` 替代 `<p>`，需要确保其子节点是内联元素（strong, span, br），`block()` 会自动将其按段落处理
- 站点自定义标签（如 `<mjx-container>`）需要在 `SKIP_SELECTORS` 或 `INLINE_TAGS` 中处理

## 验证 checklist

- [ ] `npm test` 全部测试通过
- [ ] 新增适配器的所有单元测试通过
- [ ] `npm run build` 构建成功
- [ ] 在 Chrome 中加载扩展
- [ ] 访问目标网站，验证：
  - [ ] 对话框能正确注入
  - [ ] 能向输入框写入消息并发送
  - [ ] 能捕获 AI 回复（纯文本和 markdown）
  - [ ] 能检测正在生成状态并停止
  - [ ] URL 解析正确（conversationId）
  - [ ] 引用/超链接/状态卡片已被过滤
  - [ ] markdown 格式（粗体、段落分隔）正确
