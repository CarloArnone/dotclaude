import type { RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { AdvisorPick, AdvisorResult, RadarStatus } from '../../../types'
import { card, initialTile } from '../../ui/card'
import { buttonRow } from '../../ui/chrome'
import type { Kit } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { entryKey, initialOf, tileColor } from './advisor'

export type AdvisorModel = {
  status: RadarStatus
  result: AdvisorResult | null
  scan: () => void
  copyInstall: (pick: AdvisorPick, press: UiPressArgument) => void
  hide: (pick: AdvisorPick) => void
}

const INTRO =
  'Reads the plugin catalogs of your marketplaces (and a few well-known ones) and suggests plugins that fit your recent work.'
// About two lines of a side column: a longer description is cut there, with an ellipsis.
const DESCRIPTION_MAX = 140

/** The Advisor tab: a scan button, then one card per suggested plugin. */
export function advisorBody(kit: Kit, model: AdvisorModel): (RenderNode | null)[] {
  const { Box, Button, Text } = kit.t
  const { status, result } = model
  const picks = status.isScanning || result === null ? [] : result.picks
  return [
    status.isScanning ? (
      <Box key="advisor-scanning" flexDirection="column">
        <Text color={COLORS.ecg}>Scanning…</Text>
        <Text color={COLORS.muted}>Reading the catalogs and asking the model. This can take a minute.</Text>
      </Box>
    ) : (
      <Box key="advisor-head" flexDirection="column" gap={1}>
        <Text color={COLORS.muted}>{result === null ? INTRO : summaryLine(result)}</Text>
        {buttonRow(kit.t, 'advisor-actions', [
          <Button
            key="advisor-scan"
            variant={result === null ? 'primary' : undefined}
            label={result === null ? '⌕ Scan catalogs' : '↻ Scan again'}
            onPress={model.scan}
          />,
        ])}
      </Box>
    ),
    result?.note && !status.isScanning ? <Text color={COLORS.resp}>{result.note}</Text> : null,
    status.error !== null ? <Text color={COLORS.alarm}>{status.error}</Text> : null,
    result !== null && !status.isScanning && picks.length === 0 ? (
      <Text color={COLORS.muted}>Nothing to suggest this time.</Text>
    ) : null,
    ...picks.map(pick => pickCard(kit, model, pick)),
  ]
}

export function advisorPlain(result: AdvisorResult | null): string[] {
  if (result === null) return [INTRO]
  return [summaryLine(result), ...result.picks.map(pick => `${entryKey(pick)}: ${pick.why}`)]
}

/** One suggested plugin: its initial tile, then name, author, description and why. */
function pickCard(kit: Kit, model: AdvisorModel, pick: AdvisorPick): RenderElement {
  const { Button, Text } = kit.t
  const key = entryKey(pick)
  return card(kit, `pick-${key}`, initialTile(kit, initialOf(pick.name), tileColor(pick.name), pick.name), [
    <Text bold color={COLORS.text} wrap="wrap">
      {pick.name}
    </Text>,
    <Text color={COLORS.muted} wrap="wrap">
      {pick.author === '' ? pick.marketplace : pick.author}
    </Text>,
    <Text color={COLORS.text} wrap="wrap">
      {capped(pick.description, DESCRIPTION_MAX)}
    </Text>,
    <Text color={COLORS.muted} wrap="wrap">{`Why: ${pick.why}`}</Text>,
    buttonRow(kit.t, `pick-actions-${key}`, [
      <Button key={`copy-${key}`} label="⧉ Copy install" onPress={press => model.copyInstall(pick, press)} />,
      <Button key={`hide-${key}`} label="× Hide" onPress={() => model.hide(pick)} />,
    ]),
  ])
}

function capped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function summaryLine(result: AdvisorResult): string {
  const catalogs = result.catalogCount === 1 ? '1 catalog' : `${result.catalogCount} catalogs`
  return `From ${catalogs}, scanned ${new Date(result.scannedAt).toISOString().slice(0, 10)}.`
}
