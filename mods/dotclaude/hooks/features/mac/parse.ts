// Parsers for the macOS commands the pane samples. Each answers undefined
// when the output is not what it expects, so the pane hides that row
// instead of drawing a wrong number.

import type { Battery, Container, Process } from '../../../types'

/** `top -l 2 -n 0 -s 1`: the first sample is averaged since boot, so the last one is read. */
export function parseCpu(output: string): number | undefined {
  const idles = [...output.matchAll(/^CPU usage:.*?([\d.]+)% idle/gm)]
  const last = idles.at(-1)
  if (last === undefined) return undefined

  return clampPercent(100 - Number(last[1]))
}

/** `memory_pressure`: used is what the system does not report as free. */
export function parseMemory(output: string): number | undefined {
  const free = /System-wide memory free percentage:\s*(\d+)%/.exec(output)
  if (free === null) return undefined

  return clampPercent(100 - Number(free[1]))
}

/** `df -k /`: the Capacity column of the one filesystem row. */
export function parseDisk(output: string): number | undefined {
  const row = output.split('\n')[1] ?? ''
  const capacity = /\s(\d+)%\s/.exec(row)
  if (capacity === null) return undefined

  return Number(capacity[1])
}

/** `pmset -g batt`: undefined on a Mac without an internal battery. */
export function parseBattery(output: string): Battery | undefined {
  const battery = /InternalBattery.*?\t(\d+)%;\s*([^;]+);/.exec(output)
  if (battery === null) return undefined

  const state = (battery[2] ?? '').trim()

  return {
    percent: Number(battery[1]),
    isCharging: state === 'charging' || state === 'finishing charge',
  }
}

/** `pmset -g therm`: macOS records a level only once it has warned. */
export function parseThermal(output: string): string | undefined {
  if (/No thermal warning level has been recorded/.test(output)) return 'nominal'

  const level = /thermal warning level\D*(\d+)/i.exec(output)
  if (level === null) return undefined

  return level[1] === '0' ? 'nominal' : `warning level ${level[1]}`
}

/** `ps -Aceo pid,pcpu,comm -r`: already sorted by CPU; names may hold spaces. */
export function parseProcesses(output: string, count: number): Process[] | undefined {
  const rows = output.split('\n').slice(1)
  const processes: Process[] = []
  for (const row of rows) {
    const match = /^\s*(\d+)\s+([\d.]+)\s+(.+?)\s*$/.exec(row)
    if (match === null) continue
    processes.push({ pid: Number(match[1]), cpu: Number(match[2]), name: match[3] ?? '' })
  }
  if (processes.length === 0) return undefined

  return processes.slice(0, count)
}

/** `docker ps --format '{{.Names}}\t{{.Status}}'`: one container per line. */
export function parseContainers(output: string): Container[] {
  return output
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [name = '', status = ''] = line.split('\t')
      return { name, status }
    })
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}
