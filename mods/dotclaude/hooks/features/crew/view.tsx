import type { AgentInfo, AgentStatus, RenderElement } from 'claude-code'

import type { CrewComposer } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { FINISHED_SHOWN, formatElapsed, isLive, nameOf } from './logic'

const NO_ACTIVITY = 'No tool calls yet'
const EMPTY = 'No agents are running.'

const CHIP_COLOR: Partial<Record<AgentStatus, string>> = {
  running: COLORS.ecg,
  waiting: COLORS.resp,
  failed: COLORS.alarm,
}

export type CrewModel = {
  agents: AgentInfo[]
  polledAt: number
  activity: Record<string, string>
  startedAt: Record<string, number>
  composer: CrewComposer | null
  stop: (agent: AgentInfo) => void
  toggleComposer: (agentId: string) => void
  keepDraft: (agentId: string, draft: string) => void
  send: (agent: AgentInfo, text: string) => void
  sendDraft: (agent: AgentInfo) => void
  close: () => void
}

type CardView = { elapsed: string; now: string; draft: string | undefined }

export function crewPanel(kit: Kit, model: CrewModel, columns: number): RenderElement {
  const { Box, Text } = kit.t
  const { live, finished } = split(model.agents)
  return panel(
    kit,
    'crew',
    columns,
    [
      live.length === 0 ? <Text color={COLORS.muted}>{EMPTY}</Text> : null,
      ...live.map(agent => agentCard(kit.t, model, agent, viewOf(model, agent))),
      finished.length > 0 ? (
        <Box key="crew-finished" flexDirection="column">
          <Text bold color={COLORS.muted}>
            Finished
          </Text>
          {finished.map(agent => finishedRow(kit.t, agent))}
        </Box>
      ) : null,
    ],
    model.close,
  )
}

export function crewPlain(model: Pick<CrewModel, 'agents' | 'polledAt' | 'activity' | 'startedAt' | 'composer'>): string[] {
  const { live, finished } = split(model.agents)
  const cards = live.map(agent => {
    const view = viewOf(model, agent)
    return `${nameOf(agent)} (${agent.status}, ${view.elapsed})\nWhy: ${agent.description}\nNow: ${view.now}`
  })
  const lines = cards.length > 0 ? cards : [EMPTY]
  if (finished.length > 0) {
    lines.push(`Finished: ${finished.map(agent => `${nameOf(agent)} (${agent.status})`).join(', ')}`)
  }
  return [lines.join('\n\n')]
}

function split(agents: AgentInfo[]): { live: AgentInfo[]; finished: AgentInfo[] } {
  return {
    live: agents.filter(isLive),
    finished: agents.filter(agent => !isLive(agent)).slice(-FINISHED_SHOWN).reverse(),
  }
}

function viewOf(model: Pick<CrewModel, 'polledAt' | 'activity' | 'startedAt' | 'composer'>, agent: AgentInfo): CardView {
  return {
    elapsed: formatElapsed(model.polledAt - (model.startedAt[agent.id] ?? model.polledAt)),
    now: model.activity[agent.id] ?? NO_ACTIVITY,
    draft: model.composer?.agentId === agent.id ? model.composer.draft : undefined,
  }
}

function labelled(t: Rich, agentId: string, label: string, value: string): RenderElement {
  const { Box, Text } = t
  return (
    <Box key={`${label.toLowerCase()}-${agentId}`} gap={1}>
      <Text color={COLORS.muted}>{label}</Text>
      <Box key={`${label.toLowerCase()}-value-${agentId}`} flexShrink={1} minWidth={0}>
        <Text color={COLORS.text} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    </Box>
  )
}

function composerRow(t: Rich, model: CrewModel, agent: AgentInfo, draft: string): RenderElement {
  const { Box, Button, Input } = t
  return (
    <Box key={`composer-${agent.id}`} gap={1}>
      <Input
        key={`draft-${agent.id}`}
        placeholder={`Message for ${nameOf(agent)}`}
        value={draft}
        submitLabel="send"
        onInput={value => model.keepDraft(agent.id, value)}
        onSubmit={value => model.send(agent, value)}
      />
      {buttonRow(t, `send-row-${agent.id}`, [<Button key={`send-${agent.id}`} variant="primary" label="➤ Send" onPress={() => model.sendDraft(agent)} />])}
    </Box>
  )
}

function agentCard(t: Rich, model: CrewModel, agent: AgentInfo, view: CardView): RenderElement {
  const { Box, Button, Text } = t
  return (
    <Box key={`card-${agent.id}`} flexDirection="column" borderStyle="round" borderColor={COLORS.plate} paddingX={1}>
      <Box key={`card-head-${agent.id}`} justifyContent="space-between" gap={1}>
        <Text bold color={COLORS.text} wrap="truncate-end">
          {nameOf(agent)}
        </Text>
        <Box key={`card-status-${agent.id}`} gap={1} flexShrink={0}>
          <Text color={CHIP_COLOR[agent.status] ?? COLORS.muted}>{`● ${agent.status}`}</Text>
          <Text color={COLORS.muted}>{view.elapsed}</Text>
        </Box>
      </Box>
      {labelled(t, agent.id, 'Why', agent.description)}
      {labelled(t, agent.id, 'Now', view.now)}
      {buttonRow(t, `card-actions-${agent.id}`, [
        <Button key={`stop-${agent.id}`} label="■ Stop…" onPress={() => model.stop(agent)} />,
        <Button key={`message-${agent.id}`} label="✉ Message" onPress={() => model.toggleComposer(agent.id)} />,
      ])}
      {view.draft !== undefined && composerRow(t, model, agent, view.draft)}
    </Box>
  )
}

function finishedRow(t: Rich, agent: AgentInfo): RenderElement {
  const { Box, Text } = t
  return (
    <Box key={`done-${agent.id}`} gap={1}>
      <Text color={CHIP_COLOR[agent.status] ?? COLORS.muted}>●</Text>
      <Text color={COLORS.text} wrap="truncate-end">
        {nameOf(agent)}
      </Text>
      <Text color={COLORS.muted}>{agent.status}</Text>
    </Box>
  )
}
