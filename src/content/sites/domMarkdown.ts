const SKIP_SELECTORS = 'button, svg, style, script, textarea, mat-icon'
const INLINE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'code', 'a', 'br', 'span', 'img',
  'sub', 'sup', 'u', 's', 'del', 'ins', 'kbd', 'samp', 'mark',
  'small', 'cite', 'q', 'abbr', 'dfn', 'tt', 'var',
])

export function extractMarkdownFromDom(node: Node): string {
  return normalizeMarkdown(block(node))
}

function block(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return [...node.childNodes].map(child => block(child, depth)).join('')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (element.getAttribute('aria-hidden') === 'true') return ''
  if (element.matches(SKIP_SELECTORS)) return ''

  if (tag === 'pre') {
    const code = element.querySelector('code')?.textContent ?? element.textContent ?? ''
    return `\n\`\`\`\n${code.trim()}\n\`\`\`\n`
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    return `\n${'#'.repeat(level)} ${plainText(element)}\n`
  }

  if (tag === 'p') return `\n${inlineChildren(element).trim()}\n`

  if (tag === 'blockquote') {
    return `\n${plainText(element)
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')}\n\n`
  }

  if (tag === 'ul') {
    return `\n${[...element.children].map(item => `${'  '.repeat(depth)}- ${listItemText(item, depth)}`).join('\n')}\n`
  }

  if (tag === 'ol') {
    return `\n${[...element.children].map((item, index) => `${'  '.repeat(depth)}${index + 1}. ${listItemText(item, depth)}`).join('\n')}\n`
  }

  if (tag === 'table') return tableMarkdown(element)

  if (INLINE_TAGS.has(tag)) return inline(element)
  if (hasOnlyInlineChildren(element)) return `\n${inlineChildren(element).trim()}\n`
  return [...element.childNodes].map(child => block(child, depth)).join('')
}

function hasOnlyInlineChildren(element: Element): boolean {
  const children = [...element.children]
  if (children.length === 0) return false
  return children.every(child => INLINE_TAGS.has(child.tagName.toLowerCase()))
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (element.getAttribute('aria-hidden') === 'true') return ''
  if (element.matches(SKIP_SELECTORS)) return ''

  const content = inlineChildren(element)
  if (tag === 'strong' || tag === 'b') return `**${content}**`
  if (tag === 'em' || tag === 'i') return `*${content}*`
  if (tag === 'code') return `\`${content}\``
  if (tag === 'a') {
    const href = element.getAttribute('href')
    return href ? `[${content}](${href})` : content
  }
  if (tag === 'br') return '\n'

  return content
}

function inlineChildren(element: Element): string {
  return [...element.childNodes].map(inline).join('')
}

function listItemText(element: Element, depth: number): string {
  const inlinePart = [...element.childNodes]
    .filter(child => child.nodeType !== Node.ELEMENT_NODE || !['UL', 'OL'].includes((child as Element).tagName))
    .map(inline)
    .join('')
    .trim()
  const nestedPart = [...element.children]
    .filter(child => child.tagName === 'UL' || child.tagName === 'OL')
    .map(child => block(child, depth + 1).trimEnd())
    .join('\n')
  return [inlinePart, nestedPart].filter(Boolean).join('\n')
}

function tableMarkdown(element: Element): string {
  const rows = [...element.querySelectorAll('tr')].map(row => [...row.children].map(cell => plainText(cell)).join(' | '))
  if (rows.length === 0) return ''

  const separator = rows[0].split('|').map(() => ' --- ').join('|')
  return `\n${[rows[0], separator, ...rows.slice(1)].join('\n')}\n`
}

function plainText(element: Element): string {
  return (element.textContent || '').replace(/\s+/g, ' ').trim()
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
