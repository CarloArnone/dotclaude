import type { LedgerEntry } from '../../../types'

export type LineChanges = { added: number; removed: number }

// Past this many LCS cells the exact count costs more than a hook's budget
// allows; the trimmed middle is then counted as fully replaced.
const LCS_CELL_LIMIT = 4_000_000
const WHY_MAX_WORDS = 20
const SUBJECT_MAX = 72

export const REASON_UNAVAILABLE = 'Reason unavailable'

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Int32Array(b.length + 1)
  for (const line of a) {
    const current = new Int32Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) {
      current[j] = line === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!)
    }
    previous = current
  }
  return previous[b.length]!
}

/** Lines added and removed going from `before` to `after`, as a line diff counts them. */
export function countLineChanges(before: string, after: string): LineChanges {
  const old = splitLines(before)
  const next = splitLines(after)
  let start = 0
  while (start < old.length && start < next.length && old[start] === next[start]) start++
  let oldEnd = old.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const oldMiddle = old.slice(start, oldEnd)
  const newMiddle = next.slice(start, newEnd)
  const isTooLarge = oldMiddle.length * newMiddle.length > LCS_CELL_LIMIT
  const common = isTooLarge ? 0 : lcsLength(oldMiddle, newMiddle)
  return { added: newMiddle.length - common, removed: oldMiddle.length - common }
}

export function countOccurrences(text: string, needle: string): number {
  if (needle === '') return 0
  return text.split(needle).length - 1
}

export function relativeTo(root: string, path: string): string {
  const prefix = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const twoDigits = (n: number) => String(n).padStart(2, '0')

export function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

export function calendarDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** "+24 −3", "+41", "−2"; the mockup leaves out a side that is zero. */
export function formatChange({ added, removed }: LineChanges): string {
  const parts = [added > 0 ? `+${added}` : '', removed > 0 ? `−${removed}` : ''].filter(Boolean)
  return parts.length === 0 ? '±0' : parts.join(' ')
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…]`
}

export function ledgerLine(entry: LedgerEntry): string {
  const flag = entry.isOutsidePlan ? ' **Not in the approved plan.**' : ''
  return `- ${entry.time} \`${entry.file}\` ${formatChange(entry)} ${entry.why ?? REASON_UNAVAILABLE}${flag}`
}

const withNewline = (text: string) => (text.endsWith('\n') ? text : `${text}\n`)

/** The ledger file with `line` appended under the day's section, opening one when the day is new. */
export function appendToLedger(existing: string, day: string, line: string): string {
  const document = existing === '' ? '# Ledger\n' : withNewline(existing)
  const lastDay = [...document.matchAll(/^## (\S+)$/gm)].at(-1)?.[1]
  const withDay = lastDay === day ? document : `${document}\n## ${day}\n\n`
  return `${withDay}${line}\n`
}

export function isMentionedIn(planText: string, file: string): boolean {
  return planText.includes(file) || planText.includes(baseName(file))
}

const QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g

/** The model's reply held to one plain sentence of at most twenty words. */
export function toOneSentence(reply: string): string {
  const line = reply.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  const words = line.replace(QUOTES, '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return REASON_UNAVAILABLE
  const sentence = words.slice(0, WHY_MAX_WORDS).join(' ')
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

function shortenSubject(subject: string): string {
  if (subject.length <= SUBJECT_MAX) return subject
  const cut = subject.slice(0, SUBJECT_MAX + 1).lastIndexOf(' ')
  return subject.slice(0, cut > 0 ? cut : SUBJECT_MAX)
}

/** The model's commit message without code fences, its subject held to 72 characters. */
export function tidyCommitMessage(reply: string): string {
  const lines = reply.split('\n').filter(line => !line.trim().startsWith('```'))
  const [subject = '', ...body] = lines.join('\n').trim().split('\n')
  return [shortenSubject(subject.trim()), ...body].join('\n')
}

export function entrySummary(entry: LedgerEntry): string {
  return `${entry.file} ${formatChange(entry)}: ${entry.why ?? REASON_UNAVAILABLE}`
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => HTML_ESCAPES[char]!)

function timelineNode(entry: LedgerEntry): string {
  const flag = entry.isOutsidePlan ? '<span class="flag">Not in the approved plan.</span> ' : ''
  return `<li class="${entry.isOutsidePlan ? 'n w' : 'n'}"><i></i><b>${escapeHtml(entry.time)} ${escapeHtml(baseName(entry.file))}</b>`
    + `<span class="c">${escapeHtml(formatChange(entry))}</span>`
    + `<span class="why">${flag}${escapeHtml(entry.why ?? REASON_UNAVAILABLE)}</span></li>`
}

/** A self-contained page drawing the entries as the mockup's companion timeline. */
export function timelineHtml(project: string, entries: readonly LedgerEntry[]): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ledger timeline</title>
<style>
body{margin:0;padding:24px;background:#f6f8fb;color:#1c2633;font:14px/1.45 system-ui,-apple-system,sans-serif}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 20px;color:#4a5a70}
ol{list-style:none;margin:0;padding:8px 0 16px;display:flex;overflow-x:auto}
.n{position:relative;flex:0 0 180px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:0 8px}
.n::before{content:"";position:absolute;top:6px;left:0;right:0;height:2px;background:#cdd5df}
.n:first-child::before{left:50%}.n:last-child::before{right:50%}
.n i{position:relative;width:12px;height:12px;border-radius:50%;background:#1f9d6b;box-shadow:0 0 0 4px rgba(31,157,107,.15)}
.n.w i{background:#c48a12;box-shadow:0 0 0 4px rgba(196,138,18,.15)}
.c{font-variant-numeric:tabular-nums;color:#44546b;font-size:12px}
.why{font-size:12px;color:#4a5a70}.flag{color:#c48a12;font-weight:600}
</style></head><body>
<h1>Ledger timeline</h1><p>${escapeHtml(project)}, ${entries.length} ${entries.length === 1 ? 'change' : 'changes'} this session</p>
<ol>${entries.map(timelineNode).join('')}</ol>
</body></html>
`
}
