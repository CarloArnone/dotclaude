// A small Markdown renderer for `/companion show <file.md>`: headings, flat
// lists, fenced and inline code, emphasis and links. No dependency, by design.

const SAFE_HREF = /^(https?:|mailto:|#|\/|\.{0,2}\/|[\w-]+(\.[\w-]+)*(\/|$))/i

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderLink(label: string, href: string): string {
  // A `javascript:` or `data:` link in a rendered note must not run in the view.
  if (!SAFE_HREF.test(href)) return label
  return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`
}

function renderInline(text: string): string {
  // Code spans are cut out first so emphasis and links never apply inside them.
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map(part =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${part.slice(1, -1)}</code>`
        : part
            .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => renderLink(label, href))
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^\w*])\*([^*]+)\*/g, '$1<em>$2</em>')
            .replace(/(^|[^\w_])_([^_]+)_/g, '$1<em>$2</em>'),
    )
    .join('')
}

type ListKind = 'ul' | 'ol'

function listKindOf(line: string): ListKind | undefined {
  if (/^\s*[-*+]\s+/.test(line)) return 'ul'
  if (/^\s*\d+[.)]\s+/.test(line)) return 'ol'
  return undefined
}

function listItemText(line: string): string {
  return line.replace(/^\s*([-*+]|\d+[.)])\s+/, '')
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      index += 1
      continue
    }

    const kind = listKindOf(line)
    if (kind) {
      const items: string[] = []
      while (index < lines.length && listKindOf(lines[index] ?? '') === kind) {
        items.push(`<li>${renderInline(listItemText(lines[index] ?? ''))}</li>`)
        index += 1
      }
      html.push(`<${kind}>${items.join('')}</${kind}>`)
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && isParagraphLine(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim())
      index += 1
    }
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return html.join('\n')
}

function isParagraphLine(line: string): boolean {
  return (
    line.trim() !== '' &&
    !line.startsWith('```') &&
    !/^#{1,6}\s/.test(line) &&
    listKindOf(line) === undefined
  )
}

export function markdownTitle(source: string): string | undefined {
  return /^#{1,6}\s+(.+)$/m.exec(source)?.[1]?.trim()
}
