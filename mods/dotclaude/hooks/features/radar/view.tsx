import type { RenderElement } from 'claude-code'

import type { RenderNode } from 'claude-code'

import type { RadarIdea, RadarScan, RadarStatus, RadarTab } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { tabStrip } from '../../ui/tabs'
import { COLORS } from '../../ui/tokens'
import { advisorBody } from './advisor-view'
import type { AdvisorModel } from './advisor-view'
import { kindLabel } from './logic'

const INTRO =
  "Scans your Claude Code sessions and vault for repeated work, then suggests skills, mods and agents you don't have yet."

export type RadarModel = {
  tab: RadarTab
  selectTab: (tab: RadarTab) => void
  ideas: IdeasModel
  advisor: AdvisorModel
  close: () => void
}

export type IdeasModel = {
  status: RadarStatus
  lastScan: RadarScan | null
  later: RadarIdea[]
  scan: () => void
  draft: (idea: RadarIdea) => void
  keepForLater: (idea: RadarIdea) => void
  dismiss: (idea: RadarIdea) => void
}

const TABS = [
  { id: 'ideas', label: 'Ideas' },
  { id: 'advisor', label: 'Advisor' },
] as const

export function radarPanel(kit: Kit, model: RadarModel, columns: number): RenderElement {
  return panel(
    kit,
    'radar',
    columns,
    [
      tabStrip(kit.t, 'radar-tabs', TABS, model.tab, model.selectTab),
      ...(model.tab === 'ideas' ? ideasBody(kit.t, model.ideas) : advisorBody(kit, model.advisor)),
    ],
    model.close,
  )
}

/** The Ideas tab: skills, mods and agents to build, from the person's own sessions. */
function ideasBody(t: Rich, model: IdeasModel): (RenderNode | null)[] {
  const { Box, Text, Button } = t
  const { status, lastScan: scan, later } = model
  const ideas = status.isScanning || scan === null ? [] : scan.ideas
  const hasNothingNew = scan !== null && !status.isScanning && ideas.length === 0
  const canRescan = scan !== null && !status.isScanning
  return [
    header(t, model),
    status.error !== null ? <Text color={COLORS.alarm}>{status.error}</Text> : null,
    hasNothingNew ? <Text color={COLORS.muted}>Nothing new to suggest this time.</Text> : null,
    ...ideas.map(idea => card(t, model, idea, true)),
    later.length > 0 ? (
      <Box key="radar-later" flexDirection="column" gap={1}>
        <Text color={COLORS.text} bold>
          Later
        </Text>
        {later.map(idea => card(t, model, idea, false))}
      </Box>
    ) : null,
    canRescan ? buttonRow(t, 'rescan-actions', [<Button key="scan" label="↻ Scan again" onPress={model.scan} />]) : null,
  ]
}

export function radarPlain(scan: RadarScan | null): string[] {
  const lines = scan === null ? [INTRO] : [summaryLine(scan), ...scan.ideas.map(plainText)]
  return [...lines, 'Open Radar in the terminal or the desktop app to scan and act on ideas.']
}

function header(t: Rich, model: IdeasModel): RenderElement {
  const { Box, Text, Button } = t
  if (model.status.isScanning) {
    return (
      <Box key="radar-scanning" flexDirection="column">
        <Text color={COLORS.ecg}>Scanning…</Text>
        <Text color={COLORS.muted}>Reading your sessions and asking the model. This can take a minute.</Text>
      </Box>
    )
  }
  if (model.lastScan === null) {
    return (
      <Box key="radar-intro" flexDirection="column" gap={1}>
        <Text color={COLORS.muted}>{INTRO}</Text>
        {buttonRow(t, 'scan-actions', [<Button key="scan" label="⌕ Scan now" variant="primary" onPress={model.scan} />])}
      </Box>
    )
  }
  return <Text color={COLORS.muted}>{summaryLine(model.lastScan)}</Text>
}

function card(t: Rich, model: IdeasModel, idea: RadarIdea, canKeep: boolean): RenderElement {
  const { Box, Text, Button } = t
  return (
    <Box key={`idea-${canKeep ? 'new' : 'later'}-${idea.id}`} flexDirection="column" borderStyle="round" borderColor={COLORS.plate} paddingX={1}>
      <Text color={COLORS.muted} bold>
        {kindLabel(idea.kind)}
      </Text>
      <Text color={COLORS.text} bold>
        {idea.title}
      </Text>
      <Text color={COLORS.muted}>{[idea.evidence, idea.pitch].filter(Boolean).join(' ')}</Text>
      {buttonRow(t, `idea-actions-${idea.id}`, [
        <Button key={`draft-${idea.id}`} label="✎ Draft" variant="primary" onPress={() => model.draft(idea)} />,
        canKeep ? <Button key={`later-${idea.id}`} label="◷ Later" onPress={() => model.keepForLater(idea)} /> : null,
        <Button key={`dismiss-${idea.id}`} label="× Dismiss" onPress={() => model.dismiss(idea)} />,
      ].filter(button => button !== null))}
    </Box>
  )
}

function summaryLine(scan: RadarScan): string {
  return `From ${scan.sessionCount} sessions and your vault, scanned ${new Date(scan.scannedAt).toISOString().slice(0, 10)}.`
}

function plainText(idea: RadarIdea): string {
  return `${kindLabel(idea.kind)}: ${idea.title}. ${idea.evidence}`
}
