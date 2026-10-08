// The plugin's options (plugin.json `userConfig`), read once per load from `register`'s
// `options`. Pure: no `$`.

import type { PluginOptions } from 'claude-code'

export type Config = {
  /** The notes vault; `~` stands for the home folder. */
  vaultPath: string
  /** The vault's name in Obsidian links. */
  vaultName: string
  /** The skill whose SKILL.md holds the vault's note conventions, under <claude dir>/skills/. */
  conventionsSkill: string
  /** Words or phrases in your prompt that unlock edits. */
  approvalWords: string[]
  /** Words or phrases in your prompt that lock edits again. */
  lockPhrases: string[]
  companionPort: number
}

export const DEFAULT_CONFIG: Config = {
  vaultPath: '~/Notes',
  vaultName: 'Notes',
  conventionsSkill: 'notes-conventions',
  approvalWords: ['approved', 'go ahead', 'proceed', 'lgtm', 'ship it', "let's do it", 'sounds good', 'GO'],
  lockPhrases: ['back to brainstorm', 'wait', 'stop'],
  companionPort: 4747,
}

/** The options as given, each falling back to its default when unset, blank or malformed. */
export function readConfig(options: PluginOptions): Config {
  return {
    vaultPath: text(options.vaultPath) ?? DEFAULT_CONFIG.vaultPath,
    vaultName: text(options.vaultName) ?? DEFAULT_CONFIG.vaultName,
    conventionsSkill: text(options.conventionsSkill) ?? DEFAULT_CONFIG.conventionsSkill,
    approvalWords: phrases(options.approvalWords) ?? DEFAULT_CONFIG.approvalWords,
    lockPhrases: phrases(options.lockPhrases) ?? DEFAULT_CONFIG.lockPhrases,
    companionPort: port(options.companionPort) ?? DEFAULT_CONFIG.companionPort,
  }
}

/** `~` or `~/…` under `home`; any other path as written. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  return path
}

/**
 * Whether `text` holds any of `phrases` as whole words. Matching ignores case, except for
 * a phrase written in capitals (`GO`): that one counts only when written in capitals too,
 * so "go" in a sentence never unlocks anything.
 */
export function mentionsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some(phrase => phrasePattern(phrase).test(text))
}

/**
 * Whether `text`, trimmed, starts with one of `phrases`, followed by its end, a space or one
 * of `. , ! :`: "approved." and "approved, go" do, "approved?" and "approved-ish" do not.
 * A phrase in capitals is a short shout that reads as a word too ("GO away"), so it must be
 * the whole message or followed by one of those marks: "GO" and "GO, do it" do. Case as
 * `mentionsAny` treats it.
 */
export function startsWithAny(text: string, phrases: readonly string[]): boolean {
  const trimmed = text.trim()
  return phrases.some(phrase => {
    const after = isCapitals(phrase) ? '(?=$|[.,!:])' : '(?=$|\\s|[.,!:])'
    return phrasePattern(phrase, '^', after).test(trimmed)
  })
}

function phrasePattern(phrase: string, before = "(?<![\\w'])", after = "(?![\\w'])"): RegExp {
  const words = phrase.trim().split(/\s+/).map(escapeRegExp).join('\\s+')
  return new RegExp(`${before}${words}${after}`, isCapitals(phrase) ? 'u' : 'iu')
}

function isCapitals(phrase: string): boolean {
  return /[A-Z]/.test(phrase) && phrase === phrase.toUpperCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function phrases(value: unknown): string[] | undefined {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const kept = list.filter((one): one is string => typeof one === 'string').map(one => one.trim()).filter(one => one !== '')
  return kept.length === 0 ? undefined : kept
}

function port(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number > 0 && number < 65536 ? number : undefined
}
