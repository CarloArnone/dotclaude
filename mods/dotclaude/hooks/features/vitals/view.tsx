import type { RenderElement } from 'claude-code'

import type { GatePhase, HudHeader, MainView, SideView } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS, DESKTOP_CELL } from '../../ui/tokens'
import { brailleCells } from './braille'
import type { Channel } from './channels'
import { dock, dockRows } from './dock'
import { cavemanLabel, CONTEXT_CRITICAL, formatAge, formatClock } from './readings'
import { channelSvg } from './svg'
import { autoGain, FIXED_GAIN, sweep } from './trace'

export type VitalsActions = {
  open: (view: Exclude<MainView, 'vitals'> | SideView) => void
  compact: () => void
  silence: () => void
}

export type Vitals = {
  /** The clock as the drawing is made: text, the terminal's sweep, and where the desktop's SMIL sweep starts. */
  now: number
  header: HudHeader
  contextPercent: number
  gatePhase: GatePhase
  isCompanionOpen: boolean
  caveman: string | null
  channels: Channel[]
  isAlarm: boolean
  actions: VitalsActions
}

/** The room a panel draws into: the column's cells across and the pane's rows. */
export type Room = { columns: number; rows: number }

// Values padded to this width keep the terminal's traces the same length across channels.
const TERMINAL_VALUE_COLUMNS = 9
const HEAD_ROWS = 3
const MIN_TRACE_ROWS = 2
const MAX_TRACE_ROWS = 20
const MIN_TRACE_PX = 40

type Chip = { label: string; color: string }

export function chips(vitals: Vitals): Chip[] {
  const isLocked = vitals.gatePhase === 'brainstorm'
  const list: Chip[] = [
    { label: isLocked ? 'Edits locked' : 'Edits open', color: isLocked ? COLORS.lock : COLORS.ecg },
  ]
  if (vitals.isCompanionOpen) list.push({ label: 'Companion open', color: COLORS.spo2 })
  if (vitals.caveman !== null) list.push({ label: cavemanLabel(vitals.caveman), color: COLORS.caveman })
  if (vitals.contextPercent >= CONTEXT_CRITICAL) list.push({ label: 'Context critical', color: COLORS.alarm })
  return list
}

/** The rail: banner, header, the channels sharing every spare row, the dock and the alarm's actions. */
export function vitalsPanel(kit: Kit, vitals: Vitals, room: Room): RenderElement {
  const rows = traceRows(kit, vitals, room)
  const channels = vitals.channels.map(channel =>
    kit.surface === 'terminal'
      ? terminalChannel(kit, vitals, channel, room.columns, rows)
      : desktopChannel(kit, vitals, channel, room.columns, rows),
  )
  return panel(kit, 'vitals', room.columns, [
    head(kit.t, vitals),
    ...channels,
    dock(kit, vitals.actions.open),
    alarmActions(kit.t, vitals),
  ])
}

/** vscode and mobile get the same figures as plain rows. */
export function vitalsPlain(vitals: Vitals): string[] {
  return [headline(vitals), ...chips(vitals).map(chip => chip.label), ...vitals.channels.map(plainChannelRow)]
}

/** Rows each trace gets: what the pane has left once the banner, header, labels, dock and actions are placed. */
function traceRows(kit: Kit, vitals: Vitals, room: Room): number {
  const count = Math.max(1, vitals.channels.length)
  const isDesktop = kit.surface === 'desktop'
  const buttonRowHeight = isDesktop ? 2 : 1
  const bannerRows = isDesktop ? 2 : 1
  const alarmRows = vitals.isAlarm ? buttonRowHeight : 0
  const children = 3 + count + (vitals.isAlarm ? 1 : 0)
  const fixed = bannerRows + HEAD_ROWS + dockRows(kit, room.columns) + alarmRows + (children - 1) + count * 2
  const share = Math.floor((room.rows - fixed) / count)
  return Math.min(MAX_TRACE_ROWS, Math.max(MIN_TRACE_ROWS, share))
}

function terminalChannel(kit: Extract<Kit, { surface: 'terminal' }>, vitals: Vitals, channel: Channel, columns: number, rows: number): RenderElement {
  const { Box, Raster } = kit.t
  const traceColumns = Math.max(8, columns - TERMINAL_VALUE_COLUMNS - 1)
  const drawn = sweep(vitals.now, channel.sampleMs, channel.valueAt)
  const gain = channel.isFixedGain ? FIXED_GAIN : autoGain(drawn.runs)
  return (
    <Box key={`channel-${channel.id}`} flexDirection="column">
      {channelLabel(kit, vitals, channel)}
      <Box key={`trace-row-${channel.id}`} flexDirection="row" gap={1}>
        <Raster
          key={`trace-${channel.id}`}
          columns={traceColumns}
          rows={rows}
          cells={brailleCells({ color: channelColor(vitals, channel), sweep: drawn, gain, columns: traceColumns, rows })}
        />
        <Box key={`value-${channel.id}`} width={TERMINAL_VALUE_COLUMNS} justifyContent="flex-end" alignItems="flex-end">
          {channelValue(kit.t, vitals, channel)}
        </Box>
      </Box>
      {footer(kit.t, channel)}
    </Box>
  )
}

function desktopChannel(kit: Extract<Kit, { surface: 'desktop' }>, vitals: Vitals, channel: Channel, columns: number, rows: number): RenderElement {
  const { Box, Svg } = kit.t
  const size = {
    width: Math.round(columns * DESKTOP_CELL.width),
    height: Math.max(MIN_TRACE_PX, Math.round(rows * DESKTOP_CELL.height)),
  }
  const source = channelSvg(
    {
      id: channel.id,
      color: channel.color,
      value: channel.value,
      unit: channel.unit,
      isAlarm: isChannelAlarm(vitals, channel),
      at: vitals.now,
      sampleMs: channel.sampleMs,
      valueAt: channel.valueAt,
      isFixedGain: channel.isFixedGain,
    },
    size,
  )
  return (
    <Box key={`channel-${channel.id}`} flexDirection="column">
      {channelLabel(kit, vitals, channel)}
      {/* drawn as an image: an interactive Svg is a sandboxed frame with a white page that reloads, and flashes, on every redraw */}
      <Svg alt={`${channel.label} ${channel.value}${channel.unit}`} source={source} width={size.width} height={size.height} />
      {footer(kit.t, channel)}
    </Box>
  )
}

function head(t: Rich, vitals: Vitals): RenderElement {
  const { Box, Text } = t
  const { header } = vitals
  return (
    <Box key="vitals-head" flexDirection="column">
      <Box key="vitals-project" flexDirection="row" gap={1}>
        <Text bold color={COLORS.text}>{header.project}</Text>
        {header.branch !== null && <Text color={COLORS.muted}>⎇ {header.branch}</Text>}
        {header.isDirty && <Text color={COLORS.resp}>●</Text>}
      </Box>
      <Box key="vitals-session" flexDirection="row" gap={2}>
        <Text bold color={COLORS.text}>{header.model}</Text>
        <Text color={COLORS.muted}>session {formatAge(vitals.now - header.startedAt)}</Text>
        <Text color={COLORS.muted}>{formatClock(vitals.now)}</Text>
      </Box>
      <Box key="vitals-chips" flexDirection="row" flexWrap="wrap" gap={2}>
        {chips(vitals).map(chip => (
          <Text color={chip.color}>● {chip.label}</Text>
        ))}
      </Box>
    </Box>
  )
}

function channelLabel(kit: Kit, vitals: Vitals, channel: Channel): RenderElement {
  const { Box, Text } = kit.t
  // The terminal's marker blinks with the 1 s tick, as the mockup's steps(2) animation does;
  // the desktop's stays lit, its trace's alarm bar blinks in the SVG.
  const isBlinkOff = kit.surface === 'terminal' && Math.floor(vitals.now / 1000) % 2 === 1
  const isMarkerLit = isChannelAlarm(vitals, channel) && !isBlinkOff
  return (
    <Box key={`label-${channel.id}`} flexDirection="row" gap={1}>
      {isChannelAlarm(vitals, channel) && <Text color={COLORS.alarm}>{isMarkerLit ? '▌' : ' '}</Text>}
      <Text bold color={channelColor(vitals, channel)}>{channel.label}</Text>
    </Box>
  )
}

function channelValue(t: Rich, vitals: Vitals, channel: Channel): RenderElement {
  const { Text } = t
  return (
    <Text bold color={channelColor(vitals, channel)}>
      {channel.value}
      {channel.unit}
    </Text>
  )
}

function footer(t: Rich, channel: Channel): RenderElement {
  const { Box, Text } = t
  return (
    <Box key={`foot-${channel.id}`} flexDirection="row" justifyContent="space-between">
      <Text color={COLORS.muted}>{channel.footLeft}</Text>
      <Text color={COLORS.muted}>{channel.footRight}</Text>
    </Box>
  )
}

function alarmActions(t: Rich, vitals: Vitals): RenderElement | null {
  if (!vitals.isAlarm) return null
  const { Button } = t
  return buttonRow(t, 'alarm-actions', [
    <Button key="compact" label="⇣ Compact now" variant="primary" onPress={vitals.actions.compact} />,
    <Button key="silence" label="◌ Silence" onPress={vitals.actions.silence} />,
  ])
}

function headline(vitals: Vitals): string {
  const { header } = vitals
  const branch = header.branch === null ? '' : ` on ${header.branch}${header.isDirty ? ' (uncommitted changes)' : ''}`
  return `${header.project}${branch}, ${header.model}, session ${formatAge(vitals.now - header.startedAt)}, ${formatClock(vitals.now)}`
}

function plainChannelRow(channel: Channel): string {
  const facts = [channel.footLeft, channel.footRight].filter(fact => fact !== '')
  return [`${channel.label}: ${channel.value}${channel.unit}`, ...facts].join(', ')
}

function isChannelAlarm(vitals: Vitals, channel: Channel): boolean {
  return vitals.isAlarm && channel.id === 'context'
}

function channelColor(vitals: Vitals, channel: Channel): string {
  return isChannelAlarm(vitals, channel) ? COLORS.alarm : channel.color
}
