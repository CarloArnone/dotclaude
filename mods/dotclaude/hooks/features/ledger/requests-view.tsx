import type { RenderElement, RenderNode } from 'claude-code'

import type { RequestRecord, RequestTool } from '../../../types'
import { card, initialTile } from '../../ui/card'
import { buttonRow } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { clockTime } from './logic'
import {
  FAMILY_COLORS,
  NO_COST_REASON,
  currentTurn,
  formatCost,
  formatCount,
  formatDuration,
  modelFamily,
  modelInitial,
  requestSubtitle,
  requestTokensLine,
  shortModel,
  topRequestId,
} from './requests'

export type RequestsModel = {
  requests: RequestRecord[]
  /** The request whose overview is open; null shows the list. */
  openId: string | null
  /** What the session has cost so far; null where the host keeps no cost ledger. */
  sessionCostUsd: number | null
  open: (id: string) => void
  back: () => void
}

/** The Requests tab: the list of model requests, or one request's overview. */
export function requestsBody(kit: Kit, model: RequestsModel): (RenderNode | null)[] {
  const open = model.requests.find(request => request.id === model.openId)
  return open === undefined ? requestList(kit, model) : overview(kit.t, model, open)
}

export function requestsPlain(model: Pick<RequestsModel, 'requests' | 'sessionCostUsd'>): string[] {
  return [costLine(model), ...model.requests.map(rowText)]
}

function requestList(kit: Kit, model: RequestsModel): (RenderNode | null)[] {
  const { Text } = kit.t
  const hasNoCost = model.requests.some(request => request.costUsd === null) || model.sessionCostUsd === null
  const topId = topRequestId(model.requests)
  return [
    <Text key="requests-cost" bold color={COLORS.nibp}>
      {costLine(model)}
    </Text>,
    hasNoCost ? <Text color={COLORS.muted}>{NO_COST_REASON}</Text> : null,
    model.requests.length === 0 ? <Text dimColor>No model requests yet.</Text> : null,
    ...[...model.requests].reverse().map(request => requestCard(kit, model, request, request.id === topId)),
  ]
}

/** One request as a card: the model's tile, then time and model with the cost, tools, tokens. */
function requestCard(kit: Kit, model: RequestsModel, request: RequestRecord, isTop: boolean): RenderElement {
  const { Box, Button, Text } = kit.t
  const tile = initialTile(kit, modelInitial(request.model), FAMILY_COLORS[modelFamily(request.model)], shortModel(request.model))
  return card(kit, `request-${request.id}`, tile, [
    <Box key={`request-title-${request.id}`} flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
      <Text bold color={COLORS.text} wrap="wrap">{`${clockTime(request.at)} · ${shortModel(request.model)}`}</Text>
      <Box key={`request-cost-${request.id}`} flexDirection="row" gap={1}>
        {isTop ? (
          <Text bold color={COLORS.ink} backgroundColor={COLORS.nibp}>
            {' top '}
          </Text>
        ) : null}
        <Text bold color={COLORS.nibp}>
          {formatCost(request.costUsd)}
        </Text>
      </Box>
    </Box>,
    <Text color={COLORS.muted} wrap="wrap">
      {requestSubtitle(request)}
    </Text>,
    <Text color={COLORS.text} wrap="wrap">
      {requestTokensLine(request)}
    </Text>,
    buttonRow(kit.t, `request-actions-${request.id}`, [
      <Button key={`open-${request.id}`} label="Details ›" onPress={() => model.open(request.id)} />,
    ]),
  ])
}

function overview(t: Rich, model: RequestsModel, request: RequestRecord): (RenderNode | null)[] {
  const { Box, Button, Text } = t
  const { tokens } = request
  return [
    buttonRow(t, 'request-back', [<Button key="requests-back" label="← Requests" onPress={model.back} />]),
    <Text key="request-title" bold color={COLORS.text}>
      {`${clockTime(request.at)} ${shortModel(request.model)}, ${formatDuration(request.durationMs)}`}
    </Text>,
    <Box key="request-breakdown" flexDirection="column">
      <Text color={COLORS.spo2} bold>
        Cost and tokens
      </Text>
      <Text>{`Cost ${formatCost(request.costUsd)}`}</Text>
      <Text color={COLORS.muted}>{`Input ${formatCount(tokens.input - tokens.cacheRead - tokens.cacheWrite)}`}</Text>
      <Text color={COLORS.muted}>{`Cache read ${formatCount(tokens.cacheRead)}`}</Text>
      <Text color={COLORS.muted}>{`Cache write ${formatCount(tokens.cacheWrite)}`}</Text>
      <Text color={COLORS.muted}>{`Output ${formatCount(tokens.output)}`}</Text>
    </Box>,
    <Box key="request-tools" flexDirection="column">
      <Text color={COLORS.spo2} bold>
        {request.tools.length === 1 ? '1 tool call' : `${request.tools.length} tool calls`}
      </Text>
      {request.tools.length === 0 ? <Text dimColor>This response called no tools.</Text> : null}
      {request.tools.map(call => toolLine(t, call))}
    </Box>,
  ]
}

function toolLine(t: Rich, call: RequestTool): RenderElement {
  const { Text } = t
  const mark = call.isOk === null ? '…' : call.isOk ? '✓' : '✗'
  const color = call.isOk === null ? COLORS.muted : call.isOk ? COLORS.ecg : COLORS.alarm
  return (
    <Text color={color} wrap="truncate-end">
      {`${mark} ${call.summary}  ${formatDuration(call.durationMs)}`}
    </Text>
  )
}

function costLine(model: Pick<RequestsModel, 'requests' | 'sessionCostUsd'>): string {
  const turn = currentTurn(model.requests)
  const requests = turn.count === 1 ? '1 request' : `${turn.count} requests`
  return `Session ${formatCost(model.sessionCostUsd)}, this turn ${requests} ${formatCost(turn.costUsd)}`
}

function rowText(request: RequestRecord): string {
  const tools = request.tools.length === 1 ? '1 tool' : `${request.tools.length} tools`
  return [
    clockTime(request.at),
    shortModel(request.model),
    `${formatCount(request.tokens.input)} in, ${formatCount(request.tokens.output)} out`,
    formatCost(request.costUsd),
    tools,
    formatDuration(request.durationMs),
  ].join('  ')
}
