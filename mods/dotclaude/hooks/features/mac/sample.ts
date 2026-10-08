// One sample of the Mac: every command runs in parallel with a short timeout,
// and a command that fails leaves its field out instead of failing the rest.
// The runner is handed in, so this file never touches the engine directly.

import type { Meter, Snapshot } from '../../../types'
import {
  parseBattery,
  parseContainers,
  parseCpu,
  parseDisk,
  parseMemory,
  parseProcesses,
  parseThermal,
} from './parse'

export const HISTORY_LENGTH = 60

export const EMPTY_SNAPSHOT: Snapshot = {
  latest: {},
  history: { cpu: [], memory: [], disk: [], battery: [] },
  isCharging: false,
}

// top needs a full second between its two samples, so it gets more room.
const TOP_TIMEOUT_MS = 4000
const COMMAND_TIMEOUT_MS = 3000

/** Runs a command and answers its stdout, or undefined when it failed. */
export type RunCommand = (argv: readonly string[], timeoutMs: number) => Promise<string | undefined>

export async function takeSample(run: RunCommand, previous: Snapshot): Promise<Snapshot> {
  const [top, memory, disk, battery, thermal, processes, docker] = await Promise.all([
    run(['top', '-l', '2', '-n', '0', '-s', '1'], TOP_TIMEOUT_MS),
    run(['memory_pressure'], COMMAND_TIMEOUT_MS),
    run(['df', '-k', '/'], COMMAND_TIMEOUT_MS),
    run(['pmset', '-g', 'batt'], COMMAND_TIMEOUT_MS),
    run(['pmset', '-g', 'therm'], COMMAND_TIMEOUT_MS),
    run(['ps', '-Aceo', 'pid,pcpu,comm', '-r'], COMMAND_TIMEOUT_MS),
    run(['docker', 'ps', '--format', '{{.Names}}\t{{.Status}}'], COMMAND_TIMEOUT_MS),
  ])
  const batteryReading = parsed(battery, parseBattery)
  const latest: Partial<Record<Meter, number>> = {
    cpu: parsed(top, parseCpu),
    memory: parsed(memory, parseMemory),
    disk: parsed(disk, parseDisk),
    battery: batteryReading?.percent,
  }

  return {
    latest: withoutUndefined(latest),
    history: extendHistory(previous.history, latest),
    isCharging: batteryReading?.isCharging ?? false,
    thermal: parsed(thermal, parseThermal),
    processes: parsed(processes, output => parseProcesses(output, 3)),
    containers: parsed(docker, parseContainers),
  }
}

function parsed<T>(output: string | undefined, parse: (output: string) => T | undefined): T | undefined {
  return output === undefined ? undefined : parse(output)
}

function extendHistory(
  history: Snapshot['history'],
  latest: Partial<Record<Meter, number>>,
): Snapshot['history'] {
  const next = { ...history }
  for (const meter of Object.keys(next) as Meter[]) {
    const value = latest[meter]
    if (value !== undefined) next[meter] = [...next[meter], value].slice(-HISTORY_LENGTH)
  }
  return next
}

function withoutUndefined(readings: Partial<Record<Meter, number>>): Partial<Record<Meter, number>> {
  return Object.fromEntries(Object.entries(readings).filter(([, value]) => value !== undefined))
}
