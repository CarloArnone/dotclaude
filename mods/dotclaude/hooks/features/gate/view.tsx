import type { RenderElement } from 'claude-code'

import type { GatePhase } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'

export type GateModel = {
  phase: GatePhase
  approve: () => void
  relock: () => void
  close: () => void
}

const HINT = 'Phase follows your words: approval unlocks, "back to brainstorm" locks again.'

const CHIP: Record<GatePhase, { label: string; color: string }> = {
  brainstorm: { label: 'Brainstorming, edits locked', color: COLORS.lock },
  approved: { label: 'Approved, edits open', color: COLORS.ecg },
}

export function gatePanel(kit: Kit, gate: GateModel, columns: number): RenderElement {
  const { Button, Text } = kit.t
  const chip = CHIP[gate.phase]
  const action =
    gate.phase === 'brainstorm' ? (
      <Button key="approve" variant="primary" label="✓ Approve" onPress={gate.approve} />
    ) : (
      <Button key="relock" label="↺ Back to brainstorm" onPress={gate.relock} />
    )
  return panel(
    kit,
    'gate',
    columns,
    [
      <Text color={chip.color} bold>{`● ${chip.label}`}</Text>,
      <Text dimColor>{HINT}</Text>,
      buttonRow(kit.t, 'gate-actions', [action]),
    ],
    gate.close,
  )
}

export function gatePlain(phase: GatePhase): string[] {
  return [`${CHIP[phase].label}. ${HINT}`]
}
