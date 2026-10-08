import type { ModelCompleteResult } from 'claude-code'

import type { RadarIdea, RadarKind } from '../../../types'

export type SessionDigest = { date: string; project: string; prompts: string[] }

export const STORE_KEYS = { lastScan: 'lastScan', later: 'later', dismissed: 'dismissed' } as const

const PROMPTS_PER_SESSION = 4
const PROMPT_CHARS = 300
const IDEAS_PER_KIND = 3

const KIND_KEYS: ReadonlyArray<[string, RadarKind]> = [
  ['skills', 'skill'],
  ['mods', 'mod'],
  ['agents', 'agent'],
]

export const KIND_ORDER: readonly RadarKind[] = ['skill', 'mod', 'agent']

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseRow(line: string): Record<string, unknown> | undefined {
  try {
    const row: unknown = JSON.parse(line)
    return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : undefined
  } catch {
    // A transcript read from its tail starts mid-row; that line is simply not a row.
    return undefined
  }
}

// Only rows the engine stamped with a human origin are the person's own words:
// tool results, skill bodies, task notifications, peer messages, compaction
// requests and slash-command echoes all carry another origin or none.
function promptText(row: Record<string, unknown>): string | undefined {
  if (row.type !== 'user' || row.isMeta === true || row.isSidechain === true) return undefined
  const origin = row.origin as { kind?: unknown } | undefined
  if (origin?.kind !== 'human') return undefined
  const content = (row.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const texts = content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
  return texts.length > 0 ? texts.join(' ') : undefined
}

function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function extractSession(jsonl: string, fallbackProject: string): SessionDigest {
  const prompts: string[] = []
  let date = ''
  let project = fallbackProject
  for (const line of jsonl.split('\n')) {
    if (prompts.length >= PROMPTS_PER_SESSION) break
    const row = parseRow(line)
    const text = row && promptText(row)
    if (!row || text === undefined) continue
    const compact = text.replace(/\s+/g, ' ').trim()
    if (compact === '') continue
    prompts.push(compact.slice(0, PROMPT_CHARS))
    if (date === '' && typeof row.timestamp === 'string') date = row.timestamp.slice(0, 10)
    if (typeof row.cwd === 'string') project = lastSegment(row.cwd)
  }
  return { date, project, prompts }
}

export function buildScanPrompt(input: {
  sessions: readonly SessionDigest[]
  vaultNotes: readonly string[]
  existing: readonly string[]
  dismissed: readonly string[]
}): string {
  const sessions = input.sessions
    .map(s => `- ${s.date} in ${s.project}:\n${s.prompts.map(p => `    > ${p}`).join('\n')}`)
    .join('\n')
  return [
    "Below are the person's own prompts from recent Claude Code sessions, the titles of their vault notes, and what they already have installed.",
    'Find repeated or related work that a new skill, mod (a Claude Code plugin with panes, commands or hooks) or agent would simplify.',
    'Example: release notes written by hand in one session and a changelog in another suggest a "release notes" skill.',
    '',
    'Reply with JSON only, no prose, in this shape:',
    '{ "skills": [...], "mods": [...], "agents": [...] }',
    'Each item is { "id": "kebab-case-id", "title": "Short title", "evidence": "...", "pitch": "..." }.',
    `At most ${IDEAS_PER_KIND} items per kind; fewer, or none, when the evidence is thin.`,
    'evidence must cite the concrete sessions: their date and what was asked. pitch says in one sentence what it would do.',
    'Never propose anything that duplicates what already exists, or any dismissed id.',
    '',
    '## Sessions',
    sessions,
    '',
    '## Vault notes',
    input.vaultNotes.join(', ') || '(none)',
    '',
    '## Already exists',
    input.existing.join(', ') || '(none)',
    '',
    '## Dismissed ids',
    input.dismissed.join(', ') || '(none)',
  ].join('\n')
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toIdea(raw: unknown, kind: RadarKind): RadarIdea | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const item = raw as Record<string, unknown>
  const title = asText(item.title)
  if (title === '') return undefined
  const id = slug(asText(item.id)) || slug(title)
  return { id, kind, title, evidence: asText(item.evidence), pitch: asText(item.pitch) }
}

/** The model's reply as ideas; undefined when no JSON object can be read from it. */
export function parseIdeas(reply: string): RadarIdea[] | undefined {
  // Models wrap JSON in fences or a sentence; the outermost braces hold the object.
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const groups = parsed as Record<string, unknown>
  return KIND_KEYS.flatMap(([key, kind]) => {
    const list = groups[key]
    if (!Array.isArray(list)) return []
    return list
      .map(item => toIdea(item, kind))
      .filter((idea): idea is RadarIdea => idea !== undefined)
      .slice(0, IDEAS_PER_KIND)
  })
}

/** Drops ideas already installed, dismissed, saved for later, or repeated. */
export function filterIdeas(
  ideas: readonly RadarIdea[],
  existing: readonly string[],
  hiddenIds: readonly string[],
): RadarIdea[] {
  // A plugin skill is listed as `plugin:skill`; its bare name is what an idea would repeat.
  const taken = new Set(existing.map(name => slug(name.split(':').pop() ?? name)))
  const hidden = new Set(hiddenIds)
  const seen = new Set<string>()
  return ideas.filter(idea => {
    const isKnown =
      hidden.has(idea.id) || seen.has(idea.id) || taken.has(idea.id) || taken.has(slug(idea.title))
    seen.add(idea.id)
    return !isKnown
  })
}

export function sortByKind(ideas: readonly RadarIdea[]): RadarIdea[] {
  return [...ideas].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

export function storedList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function whyUnanswered(reply: Extract<ModelCompleteResult, { isAnswered: false }>): string {
  if (reply.reason === 'api-error') return `the API returned an error (${reply.error})`
  if (reply.reason === 'aborted') return 'it took too long'
  return 'it replied with no text'
}

export function kindLabel(kind: RadarKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

export function draftPrompt(idea: RadarIdea): string {
  return [
    `Radar suggests a new ${idea.kind}: "${idea.title}".`,
    '',
    `Evidence: ${idea.evidence}`,
    `Pitch: ${idea.pitch}`,
    '',
    `Brainstorm this ${idea.kind} with me first: explore intent, options and trade-offs, and wait for my explicit approval before building anything.`,
    `Once I approve, ask me where to create it before writing any file. Do not push.`,
  ].join('\n')
}
