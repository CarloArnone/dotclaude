import { escapeHtml } from './markdown'

/** Where the companion is served: 127.0.0.1 only, on the configured port. */
export function companionUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

// The desktop app's browser pane server, in the tool-name spelling `$.mcp.call` accepts.
export const BROWSER_SERVER = 'Claude_Browser'

/** The system prompt section that tells Claude the companion is open and how to draw in it. */
export function companionSection(url: string, dir: string) {
  return {
    id: 'companion:view',
    scope: 'session',
    text:
      `A companion view is open at ${url}, served from ${dir}/. ` +
      'Every file you send to the user, and every new .html, .svg, .md, .csv or .json file you write ' +
      'in the project or the scratchpad, is shown there automatically. ' +
      'When an answer is clearer as a picture (diagram, timeline, plan, chart, table), ' +
      'write it as a self-contained HTML or SVG file and send it; keep the chat answer short and say it is in the companion.',
  } as const
}

export const USAGE = 'Usage: /companion, or /companion show <absolute path to .html or .md>'

/**
 * The plugin's own server (assets/server.py) on 127.0.0.1 only, serving `dir`. It answers
 * `token` at /__token, so the plugin can tell its own server from another program on the port.
 */
export function serverArgv(script: string, dir: string, port: number, token: string): string[] {
  // -u: the "Serving HTTP" line it prints is the readiness signal awaited, so no buffering.
  return ['python3', '-u', script, String(port), dir, token]
}

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? 'view' : slug
}

export function htmlTitle(source: string): string | undefined {
  return /<title[^>]*>([^<]*)<\/title>/i.exec(source)?.[1]?.trim() || undefined
}

/** What `/companion show` accepts: an absolute path to an .html or .md file. */
export function showableExtension(path: string): 'html' | 'md' {
  if (!path.startsWith('/')) throw new Error(`give an absolute path, not "${path}"`)
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension !== 'html' && extension !== 'md') throw new Error('only .html and .md files can be shown')
  return extension
}

export function markdownPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;padding:22px;background:#eef1f5;color:#1a2433;font:14px/1.6 'Manrope',-apple-system,BlinkMacSystemFont,sans-serif;max-width:72ch}
h1,h2,h3,h4,h5,h6{font-family:'Barlow Condensed','Avenir Next Condensed','Arial Narrow',sans-serif;font-weight:600;line-height:1.2;margin:1.2em 0 .4em}
h1{font-size:28px;margin-top:0}h2{font-size:22px}h3{font-size:18px}
a{color:#1d8fb8}
code{font:12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;background:#e1e6ed;border-radius:4px;padding:1px 4px}
pre{background:#e1e6ed;border:1px solid #cfd6df;border-radius:8px;padding:12px;overflow:auto}
pre code{background:none;padding:0}
</style>
</head>
<body>
${body}
</body>
</html>
`
}

/** How a file sent to or written for the user is shown in the companion. */
export type OutputKind = 'html' | 'svg' | 'md' | 'csv' | 'json' | 'other'

export function outputKind(path: string): OutputKind {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  return extension === 'html' || extension === 'htm'
    ? 'html'
    : extension === 'svg' || extension === 'md' || extension === 'csv' || extension === 'json'
      ? extension
      : 'other'
}

/** The kinds a newly written file is shown for; edits and other kinds would flood the view. */
export function isShownOnWrite(path: string): boolean {
  return outputKind(path) !== 'other'
}

/**
 * The session's scratchpad: /tmp/claude-<uid>/<project>/<session id>/scratchpad/, also under
 * /private on macOS. The engine does not name it to plugins, so the layout is matched.
 */
export function isScratchpadPath(path: string, sessionId: string): boolean {
  const escaped = sessionId.replace(/[^A-Za-z0-9-]/g, '')
  // A dot segment could climb out of the scratchpad while the prefix still matches.
  if (escaped === '' || /(^|\/)\.\.?(\/|$)/.test(path)) return false
  return new RegExp(`^(/private)?/tmp/claude-[^/]+/[^/]+/${escaped}/scratchpad/`).test(path)
}

/** Resolves a path the way the tool did: relative ones against the session's working folder. */
export function absolutePath(path: string, cwd: string): string {
  return path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`
}

/** Splits one CSV line, honouring double-quoted fields with "" escapes. */
export function csvCells(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  return [...cells, cell]
}

export function csvTable(source: string): string {
  const rows = source.split(/\r?\n/).filter(line => line.trim() !== '').map(csvCells)
  const [head, ...body] = rows
  if (head === undefined) return '<p>The file is empty.</p>'
  const cells = (row: string[], tag: string) => row.map(cell => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('')
  return `<table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body
    .map(row => `<tr>${cells(row, 'td')}</tr>`)
    .join('')}</tbody></table>`
}

export function jsonBlock(source: string): string {
  try {
    return `<pre><code>${escapeHtml(JSON.stringify(JSON.parse(source), null, 2))}</code></pre>`
  } catch {
    return `<p>Not valid JSON; shown as written.</p><pre><code>${escapeHtml(source)}</code></pre>`
  }
}

/** A page for a file kind that is not drawn: where it is, so it can be opened without searching. */
export function fileCard(path: string): string {
  return `<p>This file type is not drawn here. It is at:</p><pre><code>${escapeHtml(path)}</code></pre>`
}

export function outputPage(title: string, body: string, path: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;padding:22px;background:#eef1f5;color:#1a2433;font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}
.path{color:#5b6b80;font:12px ui-monospace,Menlo,monospace;margin-bottom:14px;word-break:break-all}
table{border-collapse:collapse;background:#fff}
th,td{border:1px solid #cfd6df;padding:4px 10px;text-align:left;font-variant-numeric:tabular-nums}
th{background:#e1e6ed}
pre{background:#e1e6ed;border:1px solid #cfd6df;border-radius:8px;padding:12px;overflow:auto}
code{font:12.5px ui-monospace,Menlo,monospace}
svg{max-width:100%;height:auto}
</style>
</head>
<body>
<div class="path">${escapeHtml(path)}</div>
${body}
</body>
</html>
`
}
