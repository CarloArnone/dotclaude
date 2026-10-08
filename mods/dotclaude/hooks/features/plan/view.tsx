import type { RenderElement } from 'claude-code'

import type { PlanReviewPlan, PlanReviewStatus } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { sectionLabel, splitParts } from './logic'

export const NO_PLAN = 'No plan yet. One shows up here when Claude writes a plan or spec.'

const CHIP: Record<PlanReviewStatus, { label: string; color: string }> = {
  pending: { label: 'Waiting for you', color: COLORS.lock },
  approved: { label: 'Approved', color: COLORS.ecg },
  changes: { label: 'Changes requested', color: COLORS.resp },
}

export type PlanModel = {
  plan: PlanReviewPlan | null
  comment: string
  part: number
  approve: () => void
  requestChanges: () => void
  keepComment: (text: string) => void
  showPart: (part: number) => void
  close: () => void
}

export function planPanel(kit: Kit, model: PlanModel, columns: number): RenderElement {
  return panel(kit, 'plan', columns, planBody(kit.t, model), model.close)
}

function planBody(t: Rich, model: PlanModel): (RenderElement | null)[] {
  const { Box, Text, Button, Input, Markdown } = t
  const current = model.plan
  if (current === null) return [<Text color={COLORS.muted}>{NO_PLAN}</Text>]
  const chip = CHIP[current.status]
  const parts = splitParts(current.text)
  const shown = Math.min(model.part, parts.length - 1)
  const isPending = current.status === 'pending'
  return [
    <Box key="plan-status" flexDirection="row" flexWrap="wrap" gap={1}>
      <Text key="status" bold color={chip.color}>● {chip.label}</Text>
      <Text color={COLORS.muted}>{current.name}</Text>
    </Box>,
    <Markdown key="plan" text={parts[shown] ?? ''} />,
    parts.length > 1 ? (
      <Box key="plan-parts" flexDirection="row" gap={1} alignItems="center">
        <Text color={COLORS.muted}>{`Part ${shown + 1} of ${parts.length}`}</Text>
        {buttonRow(t, 'plan-part-buttons', [
          shown > 0 ? <Button key="previous" label="‹ Previous part" onPress={() => model.showPart(shown - 1)} /> : null,
          shown < parts.length - 1 ? <Button key="next" label="Next part ›" onPress={() => model.showPart(shown + 1)} /> : null,
        ].filter(button => button !== null))}
      </Box>
    ) : null,
    isPending ? (
      <Input
        key="comment"
        placeholder="Comment for Claude (optional)"
        value={model.comment}
        submitLabel="keep"
        onInput={model.keepComment}
        onSubmit={model.keepComment}
      />
    ) : null,
    isPending
      ? buttonRow(t, 'plan-actions', [
          <Button key="approve" variant="primary" label="✓ Approve" onPress={model.approve} />,
          <Button key="changes" label="✎ Request changes" onPress={model.requestChanges} />,
        ])
      : null,
  ]
}

export function planPlain(plan: PlanReviewPlan | null): string[] {
  if (plan === null) return [NO_PLAN]
  return [`${plan.name}: ${CHIP[plan.status].label}. Review it on the terminal or the desktop app.`]
}

export type PlanCardModel = {
  plan: PlanReviewPlan
  review: () => void
  openInCompanion: () => void
}

/** The transcript card that replaces the plan's tool row. */
export function planCard(t: Rich, card: PlanCardModel): RenderElement {
  const { Box, Text, Button } = t
  return (
    <Box key="plan-card" flexDirection="column" borderStyle="round" borderColor={COLORS.plate} paddingX={1} gap={1}>
      <Box key="plan-card-text" flexDirection="column">
        <Text bold color={COLORS.text}>Plan ready for your review</Text>
        <Text color={COLORS.muted}>{cardSummary(card.plan)}</Text>
      </Box>
      {buttonRow(t, 'plan-card-actions', [
        <Button key="review" variant="primary" label="↗ Review plan" onPress={card.review} />,
        card.plan.planPath !== null ? (
          <Button key="companion" label="◫ Open in companion" onPress={card.openInCompanion} />
        ) : null,
      ].filter(button => button !== null))}
    </Box>
  )
}

export function cardSummary(plan: PlanReviewPlan): string {
  return `${plan.name}, ${sectionLabel(plan.sections)}`
}
