import type { GatePhase } from '../../../types'
import { mentionsAny, startsWithAny } from '../../config'

export const GUARD_FAILED_REASON = 'Edit blocked: the gate could not check the phase, so it refused.'

// MultiEdit is absent from this build's tool table, so the matcher compares names as strings.
export const EDIT_TOOLS = /^(Edit|Write|NotebookEdit|MultiEdit)$/

// Matched inside the path relative to the project root. `/specs/` already covers
// `/docs/specs/`. Plans are Markdown; mockups are pages and pictures too.
const PLAN_DIRS: readonly { dir: string; extensions: readonly string[] }[] = [
  { dir: '/docs/plans/', extensions: ['.md'] },
  { dir: '/specs/', extensions: ['.md'] },
  { dir: '/docs/superpowers/', extensions: ['.md'] },
  { dir: '/.claude/plans/', extensions: ['.md'] },
  { dir: '/mockups/', extensions: ['.md', '.html', '.svg'] },
]
const PLAN_SUFFIXES = ['.plan.md', '.spec.md']

export const GATE_TOAST: Record<GatePhase, string> = {
  brainstorm: 'Back to brainstorm, edits locked',
  approved: 'Approved, edits unlocked',
}

/** Why an edit is refused while brainstorming, naming the words that unlock it. */
export function denyReason(approvalWords: readonly string[]): string {
  const words = approvalWords.map(word => `"${word}"`)
  const said = words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : (words[0] ?? 'an approval')
  return `Edit blocked: the session is still brainstorming. Start your message with ${said}, or press Approve.`
}

/**
 * The phase a prompt asks for. A lock phrase anywhere locks; an approval counts only when
 * the prompt starts with it, so a question that mentions it ("is it approved?") does not.
 */
export function phaseAskedBy(text: string, words: { approvalWords: readonly string[]; lockPhrases: readonly string[] }): GatePhase | undefined {
  // Locking wins when a prompt holds both: refusing an edit is the safe mistake.
  if (mentionsAny(text, words.lockPhrases)) return 'brainstorm'
  if (startsWithAny(text, words.approvalWords)) return 'approved'
  return undefined
}

/** Whether `path` is `root` or lies under it; both already resolved. */
export function isInside(path: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`
  return path === root || path.startsWith(base)
}

export function resolvePath(path: string, cwd: string): string {
  const absolute = path.startsWith('/') ? path : `${cwd}/${path}`
  const segments: string[] = []
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/**
 * Plans and specs stay writable while brainstorming. `relative` is the resolved path relative
 * to the project root, so folders above the project never count.
 */
export function isWritableWhileBrainstorming(relative: string): boolean {
  const path = `/${relative}`
  const lower = path.toLowerCase()
  if (PLAN_SUFFIXES.some(suffix => lower.endsWith(suffix))) return true
  return PLAN_DIRS.some(({ dir, extensions }) => path.includes(dir) && extensions.some(extension => lower.endsWith(extension)))
}

export function editedPath(e: { file_path?: unknown; notebook_path?: unknown }): string | undefined {
  const path = e.notebook_path ?? e.file_path
  return typeof path === 'string' ? path : undefined
}
