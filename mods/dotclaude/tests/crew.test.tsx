import type { AgentInfo, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { answerUi, PLAIN_SURFACES, WORKSPACE } from './host'

const CWD = '/Users/user/project'

const EXPLORER: AgentInfo = {
  id: 'a1',
  name: 'explorer',
  type: 'Explore',
  description: 'Map the API stack',
  status: 'running',
}
const PLANNER: AgentInfo = { id: 'a2', type: 'Plan', description: 'Plan the backoff', status: 'waiting' }
const FINISHED: AgentInfo = { id: 'a0', type: 'general-purpose', description: 'Read README', status: 'failed' }

type World = {
  clock: MockClock
  agents: AgentInfo[]
  askAnswer: string
  stopDenial: string | undefined
  asked: string[]
  stops: unknown[]
  sends: { to: string; text: string }[]
  toasts: string[]
  lists: number
}

// The kit has no engine beneath the plugin, so the test answers every call the mod makes.
function stubEngine(on: On, agents: AgentInfo[]): World {
  const world: World = {
    clock: mock.clock(on, { now: 100_000 }),
    agents,
    askAnswer: 'Stop',
    stopDenial: undefined,
    asked: [],
    stops: [],
    sends: [],
    toasts: [],
    lists: 0,
  }
  const ui = answerUi(on)
  world.toasts = ui.toasts
  on('agent.list', () => {
    world.lists += 1
    return { value: world.agents }
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.send', ($, e) => {
    world.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions[0]?.question ?? ''
      world.asked.push(question)
      return { result: { questions: e.questions, answers: { [question]: world.askAnswer } } }
    }
    if (e.tool === 'TaskStop') {
      world.stops.push(e)
      if (world.stopDenial !== undefined) return { deny: world.stopDenial }
      return { result: { message: 'stopped', task_id: e.task_id ?? '', task_type: 'local_agent' } }
    }
    return { result: 'ok' }
  })
  return world
}

function openPane($: Engine) {
  return $.command.run({
    command: 'crew',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

function mountPane($: Engine, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') {
  return $.ui.mount({ ...WORKSPACE, surface })
}

describe('crew view', () => {
  test('draws a card per live agent and folds finished ones, on terminal and desktop', async ($, on) => {
    stubEngine(on, [FINISHED, EXPLORER, PLANNER])
    await openPane($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: 'explorer' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Plan' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '● running' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '● waiting' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Map the API stack' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Finished' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'general-purpose' })).toBeDefined()
      expect(await ui.find({ key: 'stop-a1' })).toBeDefined()
      expect(await ui.find({ key: 'stop-a0' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'No agents are running.' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('says so when no agent is running', async ($, on) => {
    stubEngine(on, [FINISHED])
    await openPane($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: 'No agents are running.' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('shows elapsed time since the spawn', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    await $.agent.spawn({ prompt: 'Map the API stack', description: 'Map the API stack' })
    await world.clock.advance(65_000)
    await openPane($)
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '1:05' })).toBeDefined()
    await ui.unmount()
  })

  // The kit's engine raises no ui.close, so stopping on close is not reachable from a test.
  test('refreshes every 2 s while open', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    await openPane($)
    const afterOpen = world.lists
    await world.clock.advance(4_000)
    expect(world.lists).toBe(afterOpen + 2)
  })

  test('falls back to plain text on vscode and mobile', async ($, on) => {
    stubEngine(on, [EXPLORER])
    await openPane($)
    for (const surface of PLAIN_SURFACES) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /explorer \(running, 0:00\)\nWhy: Map the API stack/ })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('latest activity', () => {
  test('tracks the newest tool call of each agent', async ($, on) => {
    stubEngine(on, [EXPLORER, PLANNER])
    await $.tool.call({ tool: 'Read', tool_use_id: 't1', agentId: 'a1', file_path: `${CWD}/README.md` })
    await $.tool.call({
      tool: 'Write',
      tool_use_id: 't2',
      agentId: 'a1',
      file_path: `${CWD}/hooks/register.tsx`,
      content: 'x',
    })
    await $.tool.call({ tool: 'Bash', tool_use_id: 't3', agentId: 'a2', command: 'claude plugin\n  test .' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 't4', command: 'ls' })
    await openPane($)

    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Write hooks/register.tsx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Bash claude plugin test .' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Read README.md' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Bash ls' })).toBeUndefined()
    await ui.unmount()
  })

  test('says when an agent has made no call yet', async ($, on) => {
    stubEngine(on, [EXPLORER])
    await openPane($)
    const ui = await mountPane($, 'desktop')
    expect(await ui.find({ type: 'Text', text: 'No tool calls yet' })).toBeDefined()
    await ui.unmount()
  })
})

describe('stop', () => {
  test('asks first and does nothing when the person keeps it running', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    world.askAnswer = 'Keep running'
    await openPane($)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'stop-a1' })

    expect(world.asked).toEqual(['Stop explorer?'])
    expect(world.stops).toEqual([])
    expect(world.toasts).toEqual([])
    await ui.unmount()
  })

  test('stops the agent through TaskStop once confirmed', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    await openPane($)
    const ui = await mountPane($, 'desktop')
    await ui.press({ key: 'stop-a1' })

    expect(world.asked).toEqual(['Stop explorer?'])
    expect(world.stops).toEqual([expect.objectContaining({ tool: 'TaskStop', task_id: 'a1' })])
    expect(world.toasts).toEqual(['Stopped explorer'])
    await ui.unmount()
  })

  test('says why when TaskStop fails', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    world.stopDenial = 'No task found with ID: a1'
    await openPane($)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'stop-a1' })

    expect(world.toasts).toEqual(['Could not stop explorer: No task found with ID: a1'])
    await ui.unmount()
  })
})

describe('message', () => {
  test('sends the typed text to that agent and clears the field', async ($, on) => {
    const world = stubEngine(on, [EXPLORER, PLANNER])
    await openPane($)
    for (const surface of ['terminal', 'desktop'] as const) {
      world.sends = []
      world.toasts.length = 0
      const ui = await mountPane($, surface)
      expect(await ui.find({ key: 'draft-a2' })).toBeUndefined()

      await ui.press({ key: 'message-a2' })
      expect((await ui.find({ key: 'draft-a2' }))?.props.placeholder).toBe('Message for Plan')
      expect((await ui.find({ key: 'send-a2' }))?.props.variant).toBe('primary')

      await ui.input({ key: 'draft-a2', text: 'stop after this file', kind: 'change' })
      await ui.press({ key: 'send-a2' })

      expect(world.sends).toEqual([{ to: 'a2', text: 'stop after this file' }])
      expect(world.toasts).toEqual(['Sent to Plan'])
      expect((await ui.find({ key: 'draft-a2' }))?.props.value).toBe('')

      await ui.press({ key: 'message-a2' })
      expect(await ui.find({ key: 'draft-a2' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('Enter in the field sends too', async ($, on) => {
    const world = stubEngine(on, [EXPLORER])
    await openPane($)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'message-a1' })
    await ui.input({ key: 'draft-a1', text: 'use the cached build' })

    expect(world.sends).toEqual([{ to: 'a1', text: 'use the cached build' }])
    expect(world.toasts).toEqual(['Sent to explorer'])
    await ui.unmount()
  })
})
