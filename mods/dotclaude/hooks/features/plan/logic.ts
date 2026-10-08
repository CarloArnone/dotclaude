// Pure plan helpers: no `$`, so the rules here read the same in every hook.

// `/specs/` also covers `/docs/specs/`.
const PLAN_DIRS = ['/docs/plans/', '/specs/', '/docs/superpowers/', '/.claude/plans/']
const PLAN_SUFFIXES = ['.plan.md', '.spec.md']

// One drawing shows at most 100,000 characters in all; a part this size leaves
// room for the chrome around it and keeps a long plan readable piece by piece.
export const PART_CHARS = 30_000

export function isPlanPath(path: string): boolean {
  return PLAN_DIRS.some(dir => path.includes(dir)) || PLAN_SUFFIXES.some(end => path.endsWith(end))
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// A plan's sections are its level-2 headings, the unit superpowers plans use.
export function countSections(text: string): number {
  return text.split('\n').filter(line => /^##\s/.test(line)).length
}

export function sectionLabel(count: number): string {
  return count === 1 ? '1 section' : `${count} sections`
}

// Splits at line ends so no part cuts a line in two, unless one line alone is
// longer than a part.
export function splitParts(text: string, size = PART_CHARS): string[] {
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const piece = current === '' ? line : `\n${line}`
    if (current !== '' && current.length + piece.length > size) {
      parts.push(current)
      current = line
    } else {
      current += piece
    }
    while (current.length > size) {
      parts.push(current.slice(0, size))
      current = current.slice(size)
    }
  }
  parts.push(current)
  return parts
}

export function changesMessage(name: string, comment: string): string {
  return `Changes requested on ${name}: ${comment.trim() || 'see plan'}`
}
