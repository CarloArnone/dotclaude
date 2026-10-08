import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepToolUse } from 'claude-code'

import { FAMILY_COLORS, modelFamily, modelInitial } from '../hooks/features/ledger/requests'
import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'

const ROOT = '/Users/user/Projects/my-project'

type World = { costs: (number | null)[] }

// Each session.usage() answers the next cost in `costs`: one read before a request, one after.
function world(on: On, costs: (number | null)[]): World {
  answerUi(on)
  const state: World = { costs: [...costs] }
  mock.env(on, { HOME: '/home/user' })
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 9, 30) })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => {
    const usd = state.costs.shift() ?? null
    return { value: { startedAt: 0, context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [], ...(usd === null ? {} : { cost: { usd } }) } }
  })
  on('turn.step', async function* (_$, e) {
    return STEPS[`${e.turnId}:${e.index}`] ?? emptyStep(e.turnId, e.index)
  })
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? { isError: true as const, text: 'exit 1', result: 'failed' } : { result: 'ok' }) as never)
  return state
}

const usage = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
  model: 'claude-opus-5-5',
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
})

const toolUse = (name: string, input: unknown): TurnStepToolUse => ({ name, input })

const STEPS: Record<string, unknown> = {
  't1:0': {
    turnId: 't1',
    index: 0,
    answer: '',
    toolUses: [toolUse('Read', { file_path: `${ROOT}/src/app.ts` }), toolUse('Bash', { command: 'npm test' })],
    stopReason: 'tool_use',
    usage: usage(1000, 5000, 200, 300),
  },
  't1:1': { turnId: 't1', index: 1, answer: 'Done.', toolUses: [], stopReason: 'end_turn', usage: usage(400, 6000, 0, 120) },
}

function emptyStep(turnId: string, index: number) {
  return { turnId, index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(10, 0, 0, 5) }
}

async function step($: Engine, turnId: string, index: number, agentId?: string) {
  for await (const _chunk of $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 2, ...(agentId ? { agentId } : {}) })) {
    // The chunks do not matter here; the step's result is what the plugin records.
  }
}

/** The first turn: a request that runs Read and a failing Bash, then one that answers. */
async function firstTurn($: Engine) {
  await step($, 't1', 0)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: `${ROOT}/src/app.ts` })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
  await step($, 't1', 1)
}

async function openRequests($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.command.run({ command: 'ledger', args: '' })
  const ui = await $.ui.mount({ ...WORKSPACE, surface })
  await ui.press({ key: 'ledger-tabs-requests' })
  return ui
}

describe('requests', () => {
  test('one row per request, with its real cost as the rise in the session cost', async ($, on) => {
    world(on, [0.1, 0.13, 0.13, 0.135])
    await firstTurn($)
    await $.session.measure({ context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [], cost: { usd: 0.135 }, changed: ['cost'] })
    const ui = await openRequests($)
    expect(await ui.findAll({ type: 'Text', text: /^\d\d:\d\d · opus-5-5$/ })).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: 'in 6.2k (cache 5.2k) · out 300' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'in 6.4k (cache 6.0k) · out 120' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '$0.0300' }))?.props.color).toBe('#f072b6')
    expect(await ui.find({ type: 'Text', text: '$0.0050' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Session $0.1350, this turn 2 requests $0.0350' })).toBeDefined()
  })

  test('without a cost ledger the cost reads — and says why, never an estimate', async ($, on) => {
    world(on, [null, null])
    await step($, 't1', 0)
    const ui = await openRequests($)
    expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ top $/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'This host keeps no cost ledger, so request costs are not shown.' })).toBeDefined()
  })

  test("a tool call is grouped under the request that asked for it, and no one else's", async ($, on) => {
    world(on, [0.1, 0.13, 0.13, 0.135])
    await firstTurn($)
    await $.tool.call({ tool: 'TaskStop', tool_use_id: 'x1', task_id: 'a1' } as never)
    const ui = await openRequests($)
    await ui.press({ key: 'open-t1:0' })
    expect(await ui.find({ type: 'Text', text: '2 tool calls' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ Read src\/app\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✗ Bash npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cache read 5.0k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cache write 200' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Input 1.0k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cost $0.0300' })).toBeDefined()

    await ui.press({ key: 'requests-back' })
    await ui.press({ key: 'open-t1:1' })
    expect(await ui.find({ type: 'Text', text: 'This response called no tools.' })).toBeDefined()
  })

  test("a subagent's requests stay out of the list", async ($, on) => {
    world(on, [0.1, 0.11])
    await step($, 't9', 0, 'agent-1')
    const ui = await openRequests($)
    expect(await ui.find({ type: 'Text', text: 'No model requests yet.' })).toBeDefined()
  })

  test('the list and the overview draw on the terminal and the desktop; plain text elsewhere', async ($, on) => {
    world(on, [0.1, 0.13, 0.13, 0.135])
    await firstTurn($)
    const opener = await openRequests($)
    await opener.unmount()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ key: 'open-t1:0' })).toBeDefined()
      await ui.press({ key: 'open-t1:0' })
      expect(await ui.find({ key: 'requests-back' })).toBeDefined()
      await ui.press({ key: 'requests-back' })
      await ui.unmount()
    }
    for (const surface of PLAIN_SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('cards draw on the terminal and the desktop: model tile, cost, tools subtitle with failures', async ($, on) => {
    world(on, [0.1, 0.13, 0.13, 0.135])
    await firstTurn($)
    const opener = await openRequests($)
    await opener.unmount()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect((await ui.find({ type: 'Box', key: 'request-t1:0-text' }))?.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
      expect(await ui.find({ type: 'Text', text: /^2 tools · \d+ ms · ✗ 1 failed$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^0 tools · \d+ ms$/ })).toBeDefined()
      if (surface === 'desktop') {
        const tile = (await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'opus-5-5')
        expect(String(tile?.props.source)).toContain('#c7b8ff')
      } else {
        expect((await ui.find({ type: 'Text', text: ' O ' }))?.props.backgroundColor).toBe('#c7b8ff')
      }
      await ui.unmount()
    }
  })

  test('the top badge sits beside the most expensive request only', async ($, on) => {
    world(on, [0.1, 0.13, 0.13, 0.135])
    await firstTurn($)
    const ui = await openRequests($)
    const badges = await ui.findAll({ type: 'Text', text: /^ top $/ })
    expect(badges).toHaveLength(1)
    const topCard = await ui.find({ type: 'Box', key: 'request-cost-t1:0' })
    // Beside the $0.0300 request: the badge, then the cost; beside the $0.0050 one: the cost alone.
    expect(topCard?.children).toHaveLength(2)
    expect((await ui.find({ type: 'Box', key: 'request-cost-t1:1' }))?.children).toHaveLength(1)
  })

  test('each model family has its own tile colour', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus')
    expect(modelFamily('claude-sonnet-5')).toBe('sonnet')
    expect(modelFamily('claude-haiku-4-5')).toBe('haiku')
    expect(modelFamily('other-model')).toBe('other')
    expect(new Set(Object.values(FAMILY_COLORS)).size).toBe(4)
    expect(modelInitial('claude-sonnet-5')).toBe('S')
    expect(modelInitial('other-model')).toBe('O')
  })

  test('the Edits tab is unchanged and the tabs keep their keys', async ($, on) => {
    world(on, [0.1, 0.13])
    await step($, 't1', 0)
    await $.command.run({ command: 'ledger', args: '' })
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect((await ui.find({ key: 'ledger-tabs-edits' }))?.props.variant).toBe('primary')
    expect(await ui.find({ type: 'Text', text: '.claude/ledger.md in this project' })).toBeDefined()
    const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key)
    await ui.press({ key: 'ledger-tabs-requests' })
    await ui.press({ key: 'ledger-tabs-edits' })
    expect((await ui.findAll({ type: 'Box' })).map(box => box.key)).toEqual(keys)
  })
})
