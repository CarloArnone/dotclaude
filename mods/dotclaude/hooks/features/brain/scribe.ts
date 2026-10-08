import type { SessionMessage } from 'claude-code'

import type { ScribeAnswer, ScribeNote, ScribeQuestion } from '../../../types'

export const SCRIBE_NAME = 'scribe'
export const SCRIBE_TYPE = `dotclaude:${SCRIBE_NAME}`
export const SCRIBE_MODEL = 'sonnet'
// Enough for a long session's substance while keeping one request well inside the context window.
const TRANSCRIPT_LIMIT = 60_000

export const SCRIBE_PROMPT = `You are the scribe of the user's notes vault (Markdown, Obsidian style).
You read one Claude Code session transcript and keep only what is durably worth remembering:
decisions, stated preferences, durable facts, learnings, useful links or code snippets, and project status changes.
Skip chatter, one-off steps, and anything secret (tokens, passwords, API keys, private data).

Follow the note conventions you are given exactly. Notes go in inbox/, notes/, projects/ or references/;
[[wikilinks]] for internal links, never Markdown links; no orphan notes.
Prefer appending to an existing note listed in the vault index over creating a near-duplicate:
reuse its exact path. A note body must not start with a "# " title heading, the writer adds it.

Ask a question whenever you are unsure where something belongs, whether it is general or project-specific,
or whether it is worth keeping at all. Never guess: ask.

Answer ONLY with one JSON object, no prose and no code fence:
{ "notes": [{ "path": "notes/Example.md", "title": "Example", "tags": ["area/topic"], "body": "markdown" }],
  "dailyLine": "one short line saying what was captured",
  "questions": [{ "id": "q1", "question": "Ends with a question mark?", "options": ["2 to 4 short labels"] }] }
When there is nothing worth keeping, answer with empty "notes" and say so in "dailyLine".`

/** The conventions the scribe follows when no conventions skill is installed. */
export const GENERIC_CONVENTIONS = `- Every note starts with YAML frontmatter: created (YYYY-MM-DD), tags (a list), source.
- One idea per note, titled by what it is about; prefer adding to an existing note over a near-duplicate.
- Link related notes with [[wikilinks]]; every new note links to, or is linked from, at least one other note.
- Fleeting or unsorted items go in inbox/; durable knowledge in notes/; work on a project in projects/; sources in references/.
- The daily note daily/YYYY-MM-DD.md logs what was captured that day, linking each note.`

type DraftInput = {
  date: string
  /** The vault's own note conventions (the conventions skill's SKILL.md), or GENERIC_CONVENTIONS. */
  conventions: string
  noteIndex: string[]
  transcript: string
  extraText: string
}

/** Text only, oldest first; long sessions keep their most recent part. */
export function buildTranscript(messages: readonly SessionMessage[]): string {
  const text = messages
    .filter(message => message.text.trim() !== '')
    .map(message => `${message.role}: ${message.text.trim()}`)
    .join('\n\n')
  if (text.length <= TRANSCRIPT_LIMIT) return text

  return `[earlier messages trimmed]\n\n${text.slice(-TRANSCRIPT_LIMIT)}`
}

export function draftPrompt(input: DraftInput): string {
  const extra = input.extraText.trim()

  return [
    `Today is ${input.date}.`,
    `## Note conventions\n\n${input.conventions}`,
    `## Vault index (existing notes)\n\n${input.noteIndex.join('\n') || '(none)'}`,
    extra ? `## The user asked to capture this in particular\n\n${extra}` : '',
    `## Session transcript\n\n${input.transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function finalPrompt(draft: string, answer: ScribeAnswer, replies: Record<string, string>): string {
  const answered = answer.questions
    .map(question => `- ${question.question} The user answered: ${replies[question.id]}`)
    .join('\n')

  return [
    draft,
    `## Your first draft\n\n${JSON.stringify({ notes: answer.notes, dailyLine: answer.dailyLine })}`,
    `## The user's answers to your questions\n\n${answered}`,
    'Apply the answers and return the final JSON. "questions" must now be empty.',
  ].join('\n\n')
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

function toNote(raw: unknown): ScribeNote {
  const note = raw as Partial<ScribeNote>
  if (!isString(note.path) || !isString(note.title) || !isString(note.body)) {
    throw new Error('The scribe returned a note without path, title or body')
  }

  return { path: note.path, title: note.title, body: note.body, tags: isStringList(note.tags) ? note.tags : [] }
}

function toQuestion(raw: unknown): ScribeQuestion {
  const question = raw as Partial<ScribeQuestion>
  if (!isString(question.id) || !isString(question.question) || !isStringList(question.options)) {
    throw new Error('The scribe returned a malformed question')
  }

  return { id: question.id, question: question.question, options: question.options }
}

/** Reads the outermost JSON object, tolerating a stray fence or sentence around it. */
export function parseScribeAnswer(text: string): ScribeAnswer {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The scribe did not answer with JSON')

  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  if (!Array.isArray(raw.notes) || !isString(raw.dailyLine)) {
    throw new Error('The scribe answer lacks "notes" or "dailyLine"')
  }

  return {
    notes: raw.notes.map(toNote),
    dailyLine: raw.dailyLine,
    questions: Array.isArray(raw.questions) ? raw.questions.map(toQuestion) : [],
  }
}
