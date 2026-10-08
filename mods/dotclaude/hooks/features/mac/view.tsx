// The Mac panel. Terminal and desktop share it and differ only in how a meter's
// trace is drawn; vscode and mobile get the same facts as lines.

import type { RenderElement, RenderNode } from 'claude-code'

import type { ContainerLogs, Meter, Process, Snapshot } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { DESKTOP_CELL } from '../../ui/tokens'
import { blockSparkline, svgSparkline } from './sparkline'

export type MeterSpec = { meter: Meter; label: string; color: string }

export const METERS: readonly MeterSpec[] = [
  { meter: 'cpu', label: 'CPU', color: '#3ddc97' },
  { meter: 'memory', label: 'Memory', color: '#f2c14e' },
  { meter: 'disk', label: 'Disk', color: '#4cc9f0' },
  { meter: 'battery', label: 'Battery', color: '#f072b6' },
]

export type MacModel = {
  snapshot: Snapshot
  logs: ContainerLogs | null
  endProcess: (process: Process) => void
  stopContainer: (name: string) => void
  showLogs: (name: string) => void
  hideLogs: () => void
  close: () => void
}

const LABEL_COLUMNS = 8
const VALUE_COLUMNS = 4
const CHARGING = 'charging'
// The desktop sparkline at its widest; narrower when its row has less room.
const SVG_MAX_WIDTH = 240
const SVG_HEIGHT = 24

export function macPanel(kit: Kit, model: MacModel, columns: number): RenderElement {
  const { Text } = kit.t
  return panel(
    kit,
    'mac',
    columns,
    [
      drawMeters(kit, model.snapshot, columns),
      drawProcesses(kit.t, model),
      drawDocker(kit.t, model),
      <Text dimColor>{footer(model.snapshot)}</Text>,
    ],
    model.close,
  )
}

/** The plain-text form for surfaces that draw no trace or controls. */
export function macPlain(snapshot: Snapshot): string[] {
  const meters = visibleMeters(snapshot).map(spec => {
    const charging = isChargingRow(spec, snapshot) ? ` ${CHARGING}` : ''
    return `${spec.label} ${percent(snapshot.latest[spec.meter]).trim()}${charging}`
  })
  const processes = hasProcesses(snapshot)
    ? [`Heaviest processes: ${processSummary(snapshot.processes ?? [])}`]
    : []
  const containers =
    snapshot.containers === undefined
      ? []
      : [`Docker: ${snapshot.containers.map(c => c.name).join(', ') || 'no containers running'}`]

  return [...(meters.length === 0 ? ['Sampling…'] : meters), ...processes, ...containers, footer(snapshot)]
}

/** One meter's history: block characters in the terminal, a smooth SVG line on the desktop. */
function trace(kit: Kit, spec: MeterSpec, values: readonly number[], room: number): RenderNode {
  if (kit.surface === 'terminal') {
    const { Text } = kit.t
    return <Text color={spec.color}>{blockSparkline(values, room)}</Text>
  }
  const { Svg } = kit.t
  const size = { width: Math.max(40, Math.min(SVG_MAX_WIDTH, Math.round(room * DESKTOP_CELL.width))), height: SVG_HEIGHT }
  return (
    <Svg
      source={svgSparkline(values, spec.color, size)}
      alt={`${spec.label} over the last ${values.length} samples`}
      width={size.width}
      height={size.height}
    />
  )
}

function drawMeters(kit: Kit, snapshot: Snapshot, columns: number): RenderElement {
  const { Box, Text } = kit.t
  const meters = visibleMeters(snapshot)
  if (meters.length === 0) return <Text dimColor>Sampling…</Text>

  return (
    <Box key="mac-meters" flexDirection="column">
      {meters.map(spec => {
        const isCharging = isChargingRow(spec, snapshot)
        const suffix = isCharging ? CHARGING.length + 1 : 0
        // Three gaps of one cell between label, trace, value (and suffix).
        const room = columns - LABEL_COLUMNS - VALUE_COLUMNS - suffix - 2
        return (
          <Box key={`meter-${spec.meter}`} flexDirection="row" gap={1}>
            <Box key={`meter-label-${spec.meter}`} width={LABEL_COLUMNS}>
              <Text>{spec.label}</Text>
            </Box>
            <Box key={`meter-trace-${spec.meter}`} flexGrow={1} flexShrink={1} minWidth={0}>{trace(kit, spec, snapshot.history[spec.meter], Math.max(0, room))}</Box>
            <Text bold>{percent(snapshot.latest[spec.meter])}</Text>
            {isCharging && <Text dimColor>{CHARGING}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function drawProcesses(t: Rich, model: MacModel): RenderElement | null {
  const { Box, Text, Button } = t
  const [heaviest] = model.snapshot.processes ?? []
  if (heaviest === undefined) return null

  return (
    <Box key="mac-processes" flexDirection="column">
      <Text bold>Heaviest processes</Text>
      <Text dimColor>{processSummary(model.snapshot.processes ?? [])}</Text>
      {buttonRow(t, 'process-actions', [<Button key="end-process" label="■ End process…" onPress={() => model.endProcess(heaviest)} />])}
    </Box>
  )
}

function drawDocker(t: Rich, model: MacModel): RenderElement | null {
  const { Box, Text, Button, Code } = t
  const { snapshot, logs } = model
  if (snapshot.containers === undefined) return null

  return (
    <Box key="mac-docker" flexDirection="column">
      <Text bold>Docker</Text>
      {snapshot.containers.length === 0 && <Text dimColor>No containers running.</Text>}
      {snapshot.containers.map(container => (
        <Box key={`container-${container.name}`} flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
          <Text dimColor>{`${container.name}, ${lowerFirst(container.status)}.`}</Text>
          {buttonRow(t, `container-actions-${container.name}`, [
            <Button key={`stop-${container.name}`} label="■ Stop…" onPress={() => model.stopContainer(container.name)} />,
            <Button key={`logs-${container.name}`} label="≡ Logs" onPress={() => model.showLogs(container.name)} />,
          ])}
        </Box>
      ))}
      {logs !== null && (
        <Box key="mac-logs" flexDirection="column">
          <Text dimColor>{`Last 50 lines of ${logs.name}`}</Text>
          <Code source={logs.text === '' ? '(no output)' : logs.text} wrap="truncate-end" />
          {buttonRow(t, 'logs-actions', [<Button key="hide-logs" label="× Hide logs" onPress={model.hideLogs} />])}
        </Box>
      )}
    </Box>
  )
}

function visibleMeters(snapshot: Snapshot): MeterSpec[] {
  return METERS.filter(spec => snapshot.latest[spec.meter] !== undefined)
}

function isChargingRow(spec: MeterSpec, snapshot: Snapshot): boolean {
  return spec.meter === 'battery' && snapshot.isCharging
}

function hasProcesses(snapshot: Snapshot): boolean {
  return (snapshot.processes ?? []).length > 0
}

function percent(value: number | undefined): string {
  return `${Math.round(value ?? 0)}%`.padStart(VALUE_COLUMNS)
}

function processSummary(processes: readonly Process[]): string {
  return processes.map(process => `${process.name} ${Math.round(process.cpu)}%`).join(', ')
}

function footer(snapshot: Snapshot): string {
  const gpu = "GPU needs sudo, so it isn't shown."
  return snapshot.thermal === undefined ? gpu : `Thermal state ${snapshot.thermal}. ${gpu}`
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
