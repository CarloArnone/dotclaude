import type { AgentInfo, AgentStatus } from 'claude-code'

export const FINISHED_SHOWN = 5
const ACTIVITY_MAX_CHARS = 200
const LIVE_STATUSES: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting', 'idle'])
// The argument that best names what a call works on, most specific first.
const TARGET_KEYS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'url', 'query', 'description']
const PATH_KEYS: ReadonlySet<string> = new Set(['file_path', 'notebook_path', 'path'])

export function nameOf(agent: AgentInfo): string {
  return agent.name ?? agent.type
}

export function isLive(agent: AgentInfo): boolean {
  return LIVE_STATUSES.has(agent.status)
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

function relativeTo(cwd: string, path: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

/** A call as one line: the tool and what it works on, e.g. `Write hooks/register.tsx`. */
export function describeCall(tool: string, args: Readonly<Record<string, unknown>>, cwd: string): string {
  const key = TARGET_KEYS.find(candidate => typeof args[candidate] === 'string' && args[candidate] !== '')
  if (key === undefined) return tool
  const value = String(args[key])
  const target = PATH_KEYS.has(key) ? relativeTo(cwd, value) : value.replace(/\s+/g, ' ').trim()
  return `${tool} ${target}`.slice(0, ACTIVITY_MAX_CHARS)
}

export function keepListed<T>(byId: Record<string, T>, ids: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(byId).filter(([id]) => ids.has(id)))
}
