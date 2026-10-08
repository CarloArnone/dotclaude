import type { GitPanelRemote } from '../../../types'

/** Local git reads and writes are quick; anything slower than this is stuck. */
export const LOCAL_TIMEOUT_MS = 30_000
export const GH_TIMEOUT_MS = 60_000
export const PUSH_TIMEOUT_MS = 120_000

/** One command's outcome, with a failure already put in plain words. */
export type RunOutcome = { isOk: true; stdout: string } | { isOk: false; error: string }

/**
 * One command of a run, and the command that takes it back if a later one
 * fails. `argv` is a function only where it needs the previous step's output
 * (the URL `gh repo create` prints, when that repo replaces origin).
 */
export type Step = {
  label: string
  argv: readonly string[] | ((previousStdout: string) => readonly string[])
  timeoutMs: number
  undo?: readonly string[]
}

export function stepArgv(step: Step, previousStdout: string): readonly string[] {
  return typeof step.argv === 'function' ? step.argv(previousStdout) : step.argv
}

export function lines(text: string): string[] {
  return text.split('\n').filter(line => line.trim() !== '')
}

/** A failed command in plain words: what it printed, else its exit code. */
export function failureText(command: string, exitCode: number, stderr: string, stdout: string): string {
  const said = (stderr.trim() || stdout.trim()).split('\n').slice(0, 6).join('\n')
  return said || `${command} exited with code ${exitCode}.`
}

export function parseRemotes(text: string): GitPanelRemote[] {
  const remotes: GitPanelRemote[] = []
  for (const line of lines(text)) {
    const [name, url, kind] = line.split(/\s+/)
    if (name && url && kind === '(fetch)') remotes.push({ name, url })
  }
  return remotes
}

/** `git rev-list --left-right --count @{upstream}...HEAD` prints "behind<TAB>ahead". */
export function parseAheadBehind(text: string): { ahead: number; behind: number } {
  const [behind = '0', ahead = '0'] = text.trim().split(/\s+/)
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 }
}

export function folderName(root: string): string {
  return root.split('/').filter(Boolean).pop() ?? root
}
