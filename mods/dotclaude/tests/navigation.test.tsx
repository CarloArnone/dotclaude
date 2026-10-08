import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { DockView } from '../hooks/features/vitals/dock'
import { answerUi, SURFACES, WORKSPACE } from './host'

const ROOT = '/work/app'
const SIDE = ['gate', 'plan', 'mac', 'brain', 'radar'] as const
const MAIN = ['ledger', 'companion', 'git', 'crew'] as const
const TITLE: Record<string, string> = {
  gate: 'Gate',
  plan: 'Plan review',
  mac: 'Mac',
  brain: 'Second brain',
  radar: 'Radar',
  ledger: 'Ledger',
  companion: 'Companion',
  git: 'Git',
  crew: 'Crew',
}

// Every host call opening any view makes, answered quietly: no command, file or process is real.
function world(on: On) {
  const ui = answerUi(on)
  mock.env(on, { HOME: '/home/user' })
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 20) })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'not here', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return { ui, clock }
}

/** The terminal's banner line names the panel: `▍Title`. */
function bannerText(view: string): string {
  return `▍${TITLE[view]}`
}

/** Presses a dock entry's button. */
function pressDock(ui: { press: (target: { key: string }) => Promise<unknown> }, view: DockView) {
  return ui.press({ key: `dock-${view}` })
}

async function mountTerminal($: Engine) {
  return $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
}

describe('dock', () => {
  test('a side button opens its panel beside the vitals, and Close takes it away', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    for (const view of SIDE) {
      const ui = await mountTerminal($)
      await ui.press({ key: `dock-${view}` })
      expect(await ui.find({ type: 'Text', text: bannerText(view) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▍Vitals' })).toBeDefined()
      await ui.press({ key: `close-${view}` })
      expect(await ui.find({ type: 'Text', text: bannerText(view) })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: '▍Vitals' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a main button replaces the vitals, and Close brings them back', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    for (const view of MAIN) {
      const ui = await mountTerminal($)
      await ui.press({ key: `dock-${view}` })
      expect(await ui.find({ type: 'Text', text: bannerText(view) })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▍Vitals' })).toBeUndefined()
      expect(await ui.find({ key: 'dock-gate' })).toBeUndefined()
      await ui.press({ key: `close-${view}` })
      expect(await ui.find({ type: 'Text', text: '▍Vitals' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('one side panel at a time: opening another replaces it', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    const ui = await mountTerminal($)
    await ui.press({ key: 'dock-gate' })
    await ui.press({ key: 'dock-radar' })
    expect(await ui.find({ type: 'Text', text: '▍Radar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▍Gate' })).toBeUndefined()
  })

  test('a main view and a side panel show side by side', async ($, on) => {
    world(on)
    await $.command.run({ command: 'ledger', args: '' })
    await $.command.run({ command: 'gate', args: '' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ key: 'close-ledger' })).toBeDefined()
      expect(await ui.find({ key: 'close-gate' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the dock has one button per feature, a single Companion and no palette', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    const ui = await mountTerminal($)
    const labels = (await ui.findAll({ type: 'Button' })).map(button => button.text)
    expect(labels).toEqual(['Gate', 'Plan', 'Ledger', 'Mac', 'Brain', 'Radar', 'Companion', 'Git', 'Crew'])
  })
})

describe('commands', () => {
  test('each command opens the workspace on its view', async ($, on) => {
    const { ui } = world(on)
    const shortcuts: [string, string][] = [
      ['gate', 'gate'],
      ['ledger', 'ledger'],
      ['mac', 'mac'],
      ['brain', 'brain'],
      ['radar', 'radar'],
      ['git-panel', 'git'],
      ['crew', 'crew'],
    ]
    for (const [command, view] of shortcuts) {
      await $.command.run({ command, args: '' })
      const mounted = await mountTerminal($)
      expect(await mounted.find({ type: 'Text', text: bannerText(view) })).toBeDefined()
      await mounted.unmount()
    }
    expect(ui.opened.every(id => id === 'workspace')).toBe(true)
  })

  test('/vitals brings the vitals back to the main column and keeps the side panel', async ($, on) => {
    world(on)
    await $.command.run({ command: 'crew', args: '' })
    await $.command.run({ command: 'gate', args: '' })
    await $.command.run({ command: 'vitals', args: '' })
    const ui = await mountTerminal($)
    expect(await ui.find({ type: 'Text', text: '▍Vitals' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▍Gate' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▍Crew' })).toBeUndefined()
  })

  test('the workspace opens when the session starts', async ($, on) => {
    const { ui } = world(on)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [] } }))
    on('session.model', () => ({ value: 'Opus 5.5' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    expect(ui.opened).toEqual(['workspace'])
  })
})

describe('no command is run inside the plugin', () => {
  test('dock presses, closes and cross-feature actions run no slash command', async ($, on) => {
    const { ui } = world(on)
    on('session.messages', () => ({ value: [] }))
    on('model.complete', () => ({
      value: {
        isAnswered: false as const,
        reason: 'api-error' as const,
        status: 529,
        error: 'overloaded',
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }))
    await $.command.run({ command: 'vitals', args: '' })
    const mounted = await mountTerminal($)
    for (const view of [...SIDE, ...MAIN]) {
      await mounted.press({ key: `dock-${view}` })
      await mounted.press({ key: `close-${view}` })
    }
    await mounted.press({ key: 'dock-ledger' })
    await mounted.press({ key: 'draft' })
    await mounted.press({ key: 'brain' })
    expect(ui.commandsRun).toEqual([])
  })
})

describe('layout', () => {
  test('an open side panel stands on the left, the main column on its right', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    await $.command.run({ command: 'gate', args: '' })
    const ui = await mountTerminal($)
    const banners = (await ui.findAll({ type: 'Text', text: /^▍/ })).map(found => found.text)
    expect(banners).toEqual(['▍Gate', '▍Vitals'])
  })

  test('the terminal dock puts a coloured glyph before each button, whatever the desktop style', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    const terminal = await mountTerminal($)
    const glyph = await terminal.find({ type: 'Text', text: /^◈$/ })
    expect(glyph?.props.color).toBe('#c7b8ff')
    expect(await terminal.find({ key: 'dock-gate' })).toBeDefined()
  })

  test('the desktop dock pairs each button with its panel badge', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    const desktop = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
    const tile = (await desktop.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Brain')
    expect(String(tile?.props.source)).toContain('stroke="#f072b6"')
    expect(await desktop.find({ key: 'dock-brain' })).toBeDefined()
  })
})

describe('stable keys', () => {
  /** Every Box's and Button's key in the drawing, in order. */
  async function keysOf(ui: { findAll: (query: { type: string }) => Promise<{ key?: string }[]> }) {
    const boxes = (await ui.findAll({ type: 'Box' })).map(found => found.key)
    const buttons = (await ui.findAll({ type: 'Button' })).map(found => found.key)
    return [...boxes, ...buttons]
  }

  test('every Box and Button has a key, and the ticks change none of them', async ($, on) => {
    const { clock } = world(on)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [] } }))
    on('session.model', () => ({ value: 'Opus 5.5' }))
    on('fs.stat', (_$, e) => ({ deny: `ENOENT: ${e.path}` }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'gate', args: '' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      const before = await keysOf(ui)
      expect(before.every(key => typeof key === 'string' && key !== '')).toBe(true)
      await clock.advance(1000)
      expect(await keysOf(ui)).toEqual(before)
      await clock.advance(5000)
      expect(await keysOf(ui)).toEqual(before)
      await ui.unmount()
    }
  })

  test('every view keys all its Boxes and Buttons', async ($, on) => {
    world(on)
    await $.command.run({ command: 'vitals', args: '' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      for (const view of [...SIDE, ...MAIN]) {
        await pressDock(ui, view)
        const keys = await keysOf(ui)
        expect(keys.filter(key => typeof key !== 'string' || key === ''), `${surface} ${view}`).toEqual([])
        await ui.press({ key: `close-${view}` })
      }
      await ui.unmount()
    }
  })
})
