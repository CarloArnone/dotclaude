import type { HudRateLimit } from '../../../types'

export const CONTEXT_CRITICAL = 80
export const SILENCE_MS = 10 * 60_000

// statusline.sh's accepted caveman modes, word for word.
const CAVEMAN_MODES = new Set([
  'off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-full',
  'wenyan-ultra', 'commit', 'review', 'compress',
])

/** The flag file's mode, cleaned as statusline.sh cleans it; null when not a known mode. */
export function parseCavemanMode(text: string): string | null {
  const mode = text.slice(0, 64).toLowerCase().replace(/[^a-z0-9-]/g, '')
  return CAVEMAN_MODES.has(mode) ? mode : null
}

export function cavemanLabel(mode: string): string {
  return mode === 'full' ? 'Caveman' : `Caveman ${mode}`
}

/** Mean whole-percent rise per measurement over the history, as statusline.sh computes it. */
export function burnPercent(history: readonly number[]): number {
  if (history.length < 2) return 0
  const rise = history[history.length - 1]! - history[0]!
  return rise > 0 ? Math.floor(rise / (history.length - 1)) : 0
}

export function callsPerMinute(calls: readonly number[], now: number): number {
  return calls.filter(at => at > now - 60_000 && at <= now).length
}

export function findLimit(limits: readonly HudRateLimit[], kind: string): HudRateLimit | undefined {
  return limits.find(limit => limit.kind === kind)
}

export function isAlarmOn(percent: number, now: number, silencedUntil: number): boolean {
  return percent >= CONTEXT_CRITICAL && now >= silencedUntil
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
}

export function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${Math.floor(seconds / 3600)}:${pad2(minutes)}:${pad2(seconds % 60)}`
}

/** Tokens as statusline.sh prints them: whole thousands with a k, else the count. */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.floor(tokens / 1000)}k` : `${tokens}`
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
