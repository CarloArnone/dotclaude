import type { FsEntry } from 'claude-code'

import type { NoteRef } from '../../../types'

const LIST_LIMIT = 5
const SEARCH_LIMIT = 10
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const NOTE_FOLDERS = ['inbox', 'notes', 'projects', 'references'] as const

const pad = (n: number) => String(n).padStart(2, '0')

export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function localTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function relativeTime(thenMs: number, nowMs: number): string {
  const ago = Math.max(0, nowMs - thenMs)
  if (ago < MINUTE) return 'just now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`
  const days = Math.floor(ago / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function obsidianUrl(vault: string, path: string): string {
  const file = path.replace(/\.md$/, '')
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`
}

export function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** Counts the bullets of the daily note's "## Captures" section, where this mod logs each capture. */
export function countCaptures(daily: string): number {
  const lines = daily.split('\n')
  const start = lines.findIndex(line => line.trim() === '## Captures')
  if (start === -1) return 0
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  const section = end === -1 ? rest : rest.slice(0, end)

  return section.filter(line => line.startsWith('- ')).length
}

export function newestNotes(entries: readonly FsEntry[], folder: string): NoteRef[] {
  return entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, LIST_LIMIT)
    .map(entry => ({ path: `${folder}/${entry.name}`, mtimeMs: entry.mtimeMs }))
}

/** File-name matches first, then content matches, as paths relative to the vault. */
export function mergeHits(root: string, query: string, allNotes: string[], contentHits: string[]): string[] {
  const needle = query.toLowerCase()
  const byName = allNotes.filter(file => noteName(file).toLowerCase().includes(needle))
  const relative = [...byName, ...contentHits].map(file => file.slice(root.length + 1))

  return [...new Set(relative)].slice(0, SEARCH_LIMIT)
}
