import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'
import type { Ui } from './host'
import { DF, DOCKER_PS, MEMORY_PRESSURE, PMSET_BATT, PMSET_THERM, PS, TOP } from './mac-fixtures'

const OUTPUT: Record<string, string> = {
  top: TOP,
  memory_pressure: MEMORY_PRESSURE,
  df: DF,
  'pmset -g batt': PMSET_BATT,
  'pmset -g therm': PMSET_THERM,
  ps: PS,
  'docker ps': DOCKER_PS,
  'docker logs': 'listening on :8080\n',
}

type World = { ran: string[][]; answer: string | undefined; ui: Ui; clock: MockClock }

/** Mocks everything beneath the plugin: the host commands, the dialog, the pane, the clock. */
function mockWorld(on: On, failing: readonly string[] = []): World {
  const world: World = { ran: [], answer: undefined, ui: answerUi(on), clock: mock.clock(on) }
  on('process.run', ($, e) => {
    world.ran.push([...e.argv])
    const output = OUTPUT[e.argv.slice(0, 3).join(' ')] ?? OUTPUT[e.argv.slice(0, 2).join(' ')] ?? OUTPUT[e.argv[0] ?? '']
    const isFailing = failing.includes(e.argv[0] ?? '')
    return {
      value: {
        exitCode: isFailing ? 1 : 0,
        stdout: isFailing ? '' : (output ?? ''),
        stderr: isFailing ? 'failed' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    if (world.answer === undefined) return { deny: 'dismissed' }
    const [question] = e.questions
    return { result: { questions: e.questions, answers: { [question?.question ?? '']: world.answer } } } as never
  })
  return world
}

async function openMac($: Engine, world: World): Promise<void> {
  await $.command.run({ command: 'mac', args: '' })
  await world.clock.settle()
}

const topRuns = (world: World) => world.ran.filter(argv => argv[0] === 'top').length

test('the panel draws meters, processes and docker on terminal and desktop', async ($, on) => {
  const world = mockWorld(on)
  await openMac($, world)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...WORKSPACE, surface })
    expect(await ui.find({ key: 'meter-cpu' })).toBeDefined()
    expect(await ui.find({ key: 'meter-battery' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' 20%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Code Helper 20%, WindowServer 15%, node 8%' })).toBeDefined()
    expect(await ui.find({ key: 'stop-web-dev' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "Thermal state nominal. GPU needs sudo, so it isn't shown." })).toBeDefined()
    const traces =
      surface === 'desktop'
        ? (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).endsWith('samples'))
        : await ui.findAll({ type: 'Text', text: /^[▁▂▃▄▅▆▇█]+$/ })
    expect(traces.length).toBe(4)
    await ui.unmount()
  }
})

test('a failing command hides its row and nothing else', async ($, on) => {
  const world = mockWorld(on, ['memory_pressure', 'docker'])
  await openMac($, world)

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  expect(await ui.find({ key: 'meter-memory' })).toBeUndefined()
  expect(await ui.find({ key: 'meter-cpu' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Docker' })).toBeUndefined()
  await ui.unmount()
})

test('vscode and mobile get plain text', async ($, on) => {
  const world = mockWorld(on)
  await openMac($, world)

  for (const surface of PLAIN_SURFACES) {
    const ui = await $.ui.mount({ ...WORKSPACE, surface })
    expect(await ui.find({ type: 'Text', text: 'Memory 20%' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('sampling repeats every 5 s while the panel shows and stops when it closes', async ($, on) => {
  const world = mockWorld(on)
  await openMac($, world)
  expect(topRuns(world)).toBe(1)

  await world.clock.advance(5000)
  expect(topRuns(world)).toBe(2)

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  await ui.press({ key: 'close-mac' })
  await world.clock.advance(15000)
  expect(topRuns(world)).toBe(2)
})

test('opening another side panel stops the sampling too', async ($, on) => {
  const world = mockWorld(on)
  await openMac($, world)
  await $.command.run({ command: 'gate', args: '' })
  await world.clock.advance(15000)
  expect(topRuns(world)).toBe(1)
})

// The test's $ cannot raise ui.close itself, so a stand-in plugin closes the workspace.
const CLOSER = {
  name: 'closer',
  register(on: On) {
    on('command.run', { command: 'close-workspace' }, async $ => {
      await $.ui.close({ id: 'workspace' })
      return {}
    })
  },
}

test('closing the workspace stops sampling; a session that finds it open again resumes', { plugins: [CLOSER] }, async ($, on) => {
  const world = mockWorld(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await openMac($, world)
  await $.command.run({ command: 'close-workspace', args: '' })
  await world.clock.advance(15000)
  expect(topRuns(world)).toBe(1)

  // A hot reload: the pane is still up, the timer is gone, session.start runs again.
  world.ui.panes.push('workspace')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
  expect(topRuns(world)).toBe(2)
})

test('a session without the Mac panel open does not sample', async ($, on) => {
  const world = mockWorld(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await world.clock.advance(10000)
  expect(topRuns(world)).toBe(0)
})

for (const [answer, label] of [
  ['End process', 'confirmed'],
  ['Cancel', 'cancelled'],
  [undefined, 'dismissed'],
] as const) {
  test(`end process sends SIGTERM only when ${label}`, async ($, on) => {
    const world = mockWorld(on)
    world.answer = answer
    await openMac($, world)

    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.press({ key: 'end-process' })
    const kills = world.ran.filter(argv => argv[0] === 'kill')
    expect(kills).toEqual(answer === 'End process' ? [['kill', '1001']] : [])
    expect(world.ui.toasts).toEqual(answer === 'End process' ? ['Asked Code Helper (pid 1001) to quit.'] : [])
    await ui.unmount()
  })
}

test('docker stop asks first, logs show in a code block', async ($, on) => {
  const world = mockWorld(on)
  await openMac($, world)

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
  await ui.press({ key: 'stop-web-dev' })
  expect(world.ran.some(argv => argv.join(' ') === 'docker stop web-dev')).toBe(false)

  world.answer = 'Stop container'
  await ui.press({ key: 'stop-web-dev' })
  expect(world.ran.some(argv => argv.join(' ') === 'docker stop web-dev')).toBe(true)

  await ui.press({ key: 'logs-web-dev' })
  expect(world.ran.some(argv => argv.join(' ') === 'docker logs --tail 50 web-dev')).toBe(true)
  expect((await ui.find({ type: 'Code' }))?.text).toBe('listening on :8080')
  await ui.press({ key: 'hide-logs' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})
