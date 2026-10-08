import type { RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { LedgerDraft, LedgerEntry, LedgerTab } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { tabStrip } from '../../ui/tabs'
import { COLORS } from '../../ui/tokens'
import { baseName, formatChange } from './logic'
import { requestsBody } from './requests-view'
import type { RequestsModel } from './requests-view'

export type LedgerModel = {
  tab: LedgerTab
  selectTab: (tab: LedgerTab) => void
  edits: EditsModel
  requests: RequestsModel
  close: () => void
}

export type EditsModel = {
  entries: LedgerEntry[]
  draft: LedgerDraft
  startDraft: () => void
  copyDraft: (press: UiPressArgument) => void
  saveToBrain: () => void
  showTimeline: () => void
}

const TABS = [
  { id: 'edits', label: 'Edits' },
  { id: 'requests', label: 'Requests' },
] as const

const WHERE = '.claude/ledger.md in this project'
const NO_ENTRIES = 'No changes recorded yet.'

export function ledgerPanel(kit: Kit, model: LedgerModel, columns: number): RenderElement {
  return panel(
    kit,
    'ledger',
    columns,
    [
      tabStrip(kit.t, 'ledger-tabs', TABS, model.tab, model.selectTab),
      ...(model.tab === 'edits' ? editsBody(kit.t, model.edits) : requestsBody(kit, model.requests)),
    ],
    model.close,
  )
}

/** The Edits tab: every file change of the session, and what to do with them. */
function editsBody(t: Rich, model: EditsModel): (RenderNode | null)[] {
  const { Box, Text, Button, Code } = t
  const { draft } = model
  return [
    <Text dimColor>{WHERE}</Text>,
    model.entries.length === 0 ? <Text dimColor>{NO_ENTRIES}</Text> : null,
    ...model.entries.map(entry => (
      <Box key={`entry-${entry.id}`} flexDirection="row" gap={2}>
        <Text dimColor>{entry.time}</Text>
        <Box key={`entry-text-${entry.id}`} flexDirection="column" flexShrink={1} minWidth={0}>
          <Text>
            <Text bold color={entry.isOutsidePlan ? COLORS.resp : undefined}>{baseName(entry.file)}</Text>
            {entry.added > 0 && <Text color={COLORS.ecg}>{` +${entry.added}`}</Text>}
            {entry.removed > 0 && <Text color={COLORS.alarm}>{` −${entry.removed}`}</Text>}
          </Text>
          <Text dimColor>
            {entry.isOutsidePlan && <Text color={COLORS.resp}>Not in the approved plan. </Text>}
            {entry.why ?? 'Working out why…'}
          </Text>
        </Box>
      </Box>
    )),
    buttonRow(t, 'ledger-actions', [
      <Button key="draft" variant="primary" label="✎ Draft commit message" onPress={model.startDraft} />,
      <Button key="brain" label="⊕ Save to brain" onPress={model.saveToBrain} />,
      <Button key="timeline" label="⇢ Timeline" onPress={model.showTimeline} />,
    ]),
    draft.status === 'drafting' ? <Text dimColor>Drafting a commit message…</Text> : null,
    draft.status === 'failed' ? <Text color={COLORS.alarm}>{draft.reason}</Text> : null,
    draft.status === 'ready' ? (
      <Box key="ledger-draft" flexDirection="column" gap={1}>
        <Code source={draft.text} language="text" />
        {buttonRow(t, 'ledger-copy', [<Button key="copy" label="⧉ Copy" onPress={model.copyDraft} />])}
      </Box>
    ) : null,
  ]
}

export function ledgerPlain(entries: LedgerEntry[]): string[] {
  return [WHERE, ...(entries.length === 0 ? [NO_ENTRIES] : entries.map(plainLine))]
}

function plainLine(entry: LedgerEntry): string {
  const flag = entry.isOutsidePlan ? 'Not in the approved plan. ' : ''
  return `${entry.time} ${baseName(entry.file)} ${formatChange(entry)}: ${flag}${entry.why ?? 'Working out why…'}`
}
