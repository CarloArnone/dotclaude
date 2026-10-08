// Radar's Advisor: plugin catalogs in, a few suggested plugins out. Pure: no `$`.

import type { AdvisorPick } from '../../../types'
import { COLORS } from '../../ui/tokens'
import type { SessionDigest } from './logic'

/** One plugin a marketplace catalog lists. */
export type CatalogEntry = {
  name: string
  /** The marketplace's name, as `/plugin install <name>@<marketplace>` spells it. */
  marketplace: string
  author: string
  description: string
  /** The marketplace's GitHub repo, `owner/repo`, when known. */
  repo: string | null
  isAdded: boolean
}

/** Where a marketplace's catalog file sits in its repository, in the two layouts found in the wild. */
export const CATALOG_PATHS = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json'] as const

/** Well-known marketplaces offered even when not added yet; a scan skips any whose catalog does not load. */
export const WELL_KNOWN_REPOS = ['anthropics/claude-plugins-official', 'anthropics/skills'] as const

export const ADVISOR_STORE_KEYS = { last: 'advisorLast', hidden: 'advisorHidden' } as const

const PICKS_MAX = 8
const DESCRIPTION_CHARS = 160
const ENTRIES_MAX = 600

// What a plugin or marketplace name, and a GitHub repo, may look like: anything else is
// dropped, so no catalog can slip a path or a command into a URL or an install line.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

export function isValidName(name: string): boolean {
  return NAME.test(name)
}

export function isValidRepo(repo: string): boolean {
  return REPO.test(repo) && !repo.includes('..')
}

/** The raw URL of a GitHub repo's catalog, on its default branch; only for a valid repo. */
export function catalogUrl(repo: string, path: (typeof CATALOG_PATHS)[number] = CATALOG_PATHS[0]): string {
  if (!isValidRepo(repo)) throw new Error(`Not a GitHub repository: ${repo}`)
  return `https://raw.githubusercontent.com/${repo}/HEAD/${path}`
}

/** The `owner/repo` of a marketplace source as known_marketplaces.json records it; null when not a valid GitHub repo. */
export function githubRepoOf(source: unknown): string | null {
  const record = (source ?? {}) as { source?: unknown; repo?: unknown; url?: unknown }
  const repo =
    record.source === 'github' && typeof record.repo === 'string'
      ? record.repo
      : typeof record.url === 'string'
        ? (/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(record.url)?.[1] ?? null)
        : null
  return repo !== null && isValidRepo(repo) ? repo : null
}

/**
 * The plugins a catalog lists. Both layouts carry `plugins[]` with a `name`; a description,
 * an `author` (an object or a string) and the catalog's `owner` are optional. A catalog
 * that does not parse lists nothing.
 */
export function parseCatalog(text: string, marketplace: string, repo: string | null, isAdded: boolean): CatalogEntry[] {
  if (!isValidName(marketplace)) return []
  const checkedRepo = repo !== null && isValidRepo(repo) ? repo : null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const catalog = (raw ?? {}) as { owner?: unknown; plugins?: unknown }
  if (!Array.isArray(catalog.plugins)) return []
  const owner = personName(catalog.owner)
  return catalog.plugins.flatMap(item => {
    const plugin = (item ?? {}) as { name?: unknown; description?: unknown; author?: unknown }
    if (typeof plugin.name !== 'string' || !isValidName(plugin.name.trim())) return []
    return [
      {
        name: plugin.name.trim(),
        marketplace,
        author: personName(plugin.author) || owner,
        description: typeof plugin.description === 'string' ? plugin.description.trim() : '',
        repo: checkedRepo,
        isAdded,
      },
    ]
  })
}

/** A catalog's own name, for a marketplace not added yet. */
export function catalogName(text: string): string | null {
  try {
    const name = (JSON.parse(text) as { name?: unknown }).name
    return typeof name === 'string' && isValidName(name.trim()) ? name.trim() : null
  } catch {
    return null
  }
}

export function entryKey(entry: { name: string; marketplace: string }): string {
  return `${entry.name}@${entry.marketplace}`
}

/** Installed (installed_plugins.json) and enabled (settings enabledPlugins) plugins, as `name@marketplace`. */
export function installedKeys(installedJson: string, enabledPlugins: unknown): Set<string> {
  const keys = new Set<string>()
  try {
    const installed = JSON.parse(installedJson) as { plugins?: Record<string, unknown> }
    for (const key of Object.keys(installed.plugins ?? {})) keys.add(key)
  } catch {
    // An unreadable registry hides nothing; the enabled list still does.
  }
  if (enabledPlugins !== null && typeof enabledPlugins === 'object') {
    for (const key of Object.keys(enabledPlugins)) keys.add(key)
  }
  return keys
}

/** The entries worth suggesting: not installed, not hidden, each listed once (the first catalog wins). */
export function candidates(entries: readonly CatalogEntry[], installed: ReadonlySet<string>, hidden: readonly string[]): CatalogEntry[] {
  const installedNames = new Set([...installed].map(key => key.split('@')[0]))
  const skip = new Set(hidden)
  const seen = new Set<string>()
  return entries.filter(entry => {
    const key = entryKey(entry)
    const isKept = !seen.has(key) && !skip.has(key) && !installed.has(key) && !installedNames.has(entry.name)
    seen.add(key)
    return isKept
  })
}

export function buildAdvisorPrompt(input: {
  entries: readonly CatalogEntry[]
  sessions: readonly SessionDigest[]
  installed: readonly string[]
}): string {
  const catalog = input.entries
    .slice(0, ENTRIES_MAX)
    .map(entry => `- ${entryKey(entry)} by ${entry.author || 'unknown'}: ${entry.description.slice(0, DESCRIPTION_CHARS)}`)
    .join('\n')
  const sessions = input.sessions
    .map(session => `- ${session.date} in ${session.project}: ${session.prompts.join(' / ')}`)
    .join('\n')
  return [
    "Below are Claude Code plugins from the marketplaces the person can reach, the person's own recent prompts, and what they already have installed.",
    `Pick the ${PICKS_MAX - 3} to ${PICKS_MAX} plugins that would help this person most, judged by their prompts.`,
    'Only pick plugins from the catalog list, spelled exactly as listed (name@marketplace). Never invent one.',
    '',
    'Reply with JSON only, no prose, in this shape:',
    '{ "picks": [{ "name": "plugin-name", "marketplace": "marketplace-name", "why": "one sentence citing their work" }] }',
    '',
    '## Catalog',
    catalog || '(none)',
    '',
    '## Recent prompts',
    sessions || '(none)',
    '',
    '## Installed',
    input.installed.join(', ') || '(none)',
  ].join('\n')
}

/** The model's picks that name a catalog entry, in its order, each once; anything else is dropped. */
export function parsePicks(reply: string, entries: readonly CatalogEntry[]): AdvisorPick[] {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return []
  }
  const list = (parsed as { picks?: unknown }).picks
  if (!Array.isArray(list)) return []
  const byKey = new Map(entries.map(entry => [entryKey(entry), entry]))
  const picked = new Set<string>()
  const picks: AdvisorPick[] = []
  for (const item of list) {
    const pick = (item ?? {}) as { name?: unknown; marketplace?: unknown; why?: unknown }
    if (typeof pick.name !== 'string' || typeof pick.marketplace !== 'string') continue
    const key = `${pick.name.trim()}@${pick.marketplace.trim()}`
    const entry = byKey.get(key)
    if (entry === undefined || picked.has(key)) continue
    picked.add(key)
    picks.push({ ...entry, why: typeof pick.why === 'string' ? pick.why.trim() : '' })
    if (picks.length === PICKS_MAX) break
  }
  return picks
}

/** What to paste to install a pick: the marketplace first when it is not added yet. */
export function installCommand(pick: AdvisorPick): string {
  const install = `/plugin install ${pick.name}@${pick.marketplace}`
  return pick.isAdded || pick.repo === null ? install : `/plugin marketplace add ${pick.repo}\n${install}`
}

const TILE_COLORS = [COLORS.ecg, COLORS.spo2, COLORS.resp, COLORS.nibp, COLORS.lock, COLORS.caveman] as const

/** A tile colour that is always the same for a name. */
export function tileColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TILE_COLORS[hash % TILE_COLORS.length]!
}

export function initialOf(name: string): string {
  return (/[a-z0-9]/i.exec(name)?.[0] ?? '?').toUpperCase()
}

function personName(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const name = (value ?? {}) as { name?: unknown }
  return typeof name.name === 'string' ? name.name.trim() : ''
}
