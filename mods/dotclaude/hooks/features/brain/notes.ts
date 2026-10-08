import type { ScribeAnswer, ScribeNote } from '../../../types'
import { noteName } from './vault'

const ALLOWED_PATH = /^(inbox|notes|projects|references)\/[^/].*\.md$/

/**
 * Keeps the scribe inside the vault's note folders: no absolute paths, no daily/ rewrites,
 * and no segment starting with a dot (`..`, or a hidden folder such as `.obsidian`).
 */
export function isAllowedNotePath(path: string): boolean {
  return ALLOWED_PATH.test(path) && !path.split('/').some(segment => segment.startsWith('.'))
}

/** One line of plain text: newlines and control characters become spaces, runs of them one. */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The scribe's answer with every field that lands in frontmatter, a heading or a list item held
 * to one line and made inert like a body.
 */
export function cleanAnswer(answer: ScribeAnswer): ScribeAnswer {
  const line = (text: string) => neutraliseBody(oneLine(text))
  return {
    ...answer,
    notes: answer.notes.map(note => ({ ...note, title: line(note.title), tags: note.tags.map(line).filter(Boolean) })),
    dailyLine: line(answer.dailyLine),
  }
}

const PREVIEW_LINES = 40

// A fence line: indent, three or more backticks or tildes, then the block's language.
const FENCE = /^(\s*(?:`{3,}|~{3,})\s*)([^\s`]*)/
// Obsidian runs these when a note is opened: Dataview's JavaScript blocks and inline `$= …`
// queries, and Templater's <% … %> tags.
const RUNNABLE_FENCE = /^dataviewjs$/i
const SCRIPT_FENCE = /^(js|javascript|dataviewjs)$/i
const INLINE_DATAVIEW_JS = /`\$=/g
const TEMPLATER_TAG = /<%/g

function fenceLanguages(body: string): string[] {
  return body.split('\n').flatMap(line => {
    const fence = FENCE.exec(line)
    return fence ? [fence[2] ?? ''] : []
  })
}

function hasRunnableCode(body: string): boolean {
  return fenceLanguages(body).some(language => RUNNABLE_FENCE.test(language)) || /`\$=|<%/.test(body)
}

/**
 * The body with what Obsidian would run made inert: a dataviewjs block becomes a text block,
 * an inline `$= query loses its trigger and a Templater tag is escaped. The text stays readable.
 */
export function neutraliseBody(body: string): string {
  return body
    .split('\n')
    .map(line => line.replace(FENCE, (fence, opening: string, language: string) => (RUNNABLE_FENCE.test(language) ? `${opening}text` : fence)))
    .join('\n')
    .replace(INLINE_DATAVIEW_JS, '`\\$=')
    .replace(TEMPLATER_TAG, '&lt;%')
}

/** The warnings shown above a note's body before it is saved, if any. */
export function codeWarnings(body: string): string[] {
  const languages = fenceLanguages(body)
  const warnings: string[] = []
  if (hasRunnableCode(body)) warnings.push('⚠ Holds dataviewjs or Templater code: it is saved as plain text, so it cannot run.')
  if (languages.some(language => SCRIPT_FENCE.test(language))) warnings.push('⚠ Holds JavaScript code blocks: read them before saving.')
  else if (languages.length > 0) warnings.push('⚠ Holds code blocks: read them before saving.')
  return warnings
}

/** What the scribe proposes, each note in full as it will be written, for the question asked first. */
export function capturePreview(answer: ScribeAnswer): string {
  const notes = answer.notes.map(note => {
    const lines = neutraliseBody(note.body.trim()).split('\n')
    const shown = lines.slice(0, PREVIEW_LINES).map(line => `    ${line}`.trimEnd())
    const more = lines.length > PREVIEW_LINES ? [`    +${lines.length - PREVIEW_LINES} more lines`] : []
    const warnings = codeWarnings(note.body).map(warning => `  ${warning}`)
    return [`- ${note.path}`, ...warnings, ...shown, ...more].join('\n')
  })
  return [...(notes.length === 0 ? ['(no notes)'] : notes), '', `Daily note: ${answer.dailyLine}`].join('\n')
}

export function newNoteText(note: ScribeNote, date: string, source: string): string {
  const frontmatter = ['---', `created: ${date}`, `tags: [${note.tags.join(', ')}]`, `source: ${source}`, '---']

  return `${frontmatter.join('\n')}\n\n# ${note.title}\n\n${neutraliseBody(note.body.trim())}\n`
}

/** Never overwrites: the new content lands under a dated heading after what is there. */
export function appendDatedSection(existing: string, body: string, date: string): string {
  return `${existing.trimEnd()}\n\n## ${date}\n\n${neutraliseBody(body.trim())}\n`
}

export function newDailyText(date: string): string {
  return `---\ncreated: ${date}\ntags: [daily]\n---\n\n# ${date}\n`
}

/** Appends the bullet at the end of "## Captures", creating the section when the note has none. */
export function addCaptureLine(daily: string, line: string): string {
  const lines = daily.trimEnd().split('\n')
  const start = lines.findIndex(text => text.trim() === '## Captures')
  if (start === -1) return `${lines.join('\n')}\n\n## Captures\n\n${line}\n`

  const next = lines.findIndex((text, i) => i > start && text.startsWith('## '))
  let insertAt = next === -1 ? lines.length : next
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1
  lines.splice(insertAt, 0, line)

  return `${lines.join('\n')}\n`
}

/** One bullet for the daily note, linking every captured note so none is an orphan. */
export function captureLine(answer: ScribeAnswer, time: string): string {
  const links = answer.notes.map(note => `[[${noteName(note.path)}]]`).join(' ')

  return `- ${time} — ${answer.dailyLine.trim()}${links ? ` ${links}` : ''}`
}
