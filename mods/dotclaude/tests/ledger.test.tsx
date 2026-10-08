import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'

const ROOT = '/work/proj'
const HOME = '/home/user'
const SESSION = 'session-1'
const PLAN_PATH = `${ROOT}/docs/plans/backoff.md`
const LEDGER_PATH = `${ROOT}/.claude/ledger.md`
const NOW = new Date(2026, 9, 7, 21, 2).getTime()
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type World = { files: Map<string, string>; prompts: string[]; spawned: string[]; toasts: string[] }

/** The engine beneath the plugin: files in memory, a fixed session, a model that answers `reply`. */
function world(on: On, reply: string | null, files: Record<string, string> = {}): World {
  const ui = answerUi(on)
  const state: World = { files: new Map(Object.entries(files)), prompts: [], spawned: [], toasts: ui.toasts }
  mock.env(on, { HOME, TMPDIR: '/tmp/' })
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: SESSION }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Add backoff', toolUses: [] },
      { role: 'assistant', text: 'I will add exponential backoff to the API host.', toolUses: [] },
    ],
  }))
  on('fs.exists', (_$, e) => ({ value: state.files.has(e.path) || [...state.files.keys()].some(path => path.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$, e) => {
    // The companion's page shell, read from the plugin's own folder.
    if (e.path.endsWith('/assets/index.html')) return { value: '<meta name="generator" content="companion-shell">' }
    const text = state.files.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', (_$, e) => {
    state.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('model.complete', (_$, e) => {
    state.prompts.push(e.prompt)
    return {
      value: reply === null
        ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
        : { isAnswered: true, text: reply, usage: USAGE },
    }
  })
  on('agent.spawn', (_$, e) => {
    state.spawned.push(e.prompt)
    return { model: 'sonnet', agentId: 'scribe-1', result: { agentId: 'scribe-1' } } as never
  })
  on('http.fetch', () => {
    throw new Error('connection refused')
  })
  // The companion saves its token through `sh` (umask 077); text and path are the last arguments.
  on('process.run', (_$, e) => {
    const [text, path] = e.argv.slice(-2)
    if (e.argv[0] !== 'sh' || text === undefined || path === undefined) throw new Error(`unexpected command ${e.argv.join(' ')}`)
    state.files.set(path, text)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e, next) {
    yield { stream: 'stdout' as const, text: 'Serving HTTP on 127.0.0.1 port 4747' }
    await new Promise(resolve => next.signal.addEventListener('abort', resolve))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  on('mcp.call', () => ({ value: { isError: false, content: [] } }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create' } }))
  return state
}

const edit = (file: string, old_string: string, new_string: string) =>
  ({ tool: 'Edit' as const, file_path: `${ROOT}/${file}`, old_string, new_string })

async function approveEdits($: Engine) {
  await $.command.run({ command: 'gate', args: 'approve' })
}

async function openLedger($: Engine) {
  await $.command.run({ command: 'ledger', args: '' })
}

/** Every text the ledger draws on `surface`, joined, so a test reads it as a person would. */
async function paneText($: Engine, surface: RenderSurface = 'terminal'): Promise<string> {
  const ui = await $.ui.mount({ ...WORKSPACE, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts.join('\n')
}

describe('recording', () => {
  test('an Edit becomes an entry with its line counts, then its why and ledger line', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Added exponential backoff so reconnects stop flooding the proxy.')
    await approveEdits($)
    await openLedger($)

    await $.tool.call(edit('src/link.swift', 'let a = 1\nlet b = 2\n', 'let a = 1\nlet c = 3\nlet d = 4\n'))

    const pending = await paneText($)
    expect(pending).toContain('21:02')
    expect(pending).toContain('link.swift')
    expect(pending).toContain(' +2')
    expect(pending).toContain(' −1')
    expect(pending).toContain('Working out why…')

    await clock.settle()

    expect(await paneText($)).toContain('Added exponential backoff so reconnects stop flooding the proxy.')
    expect(state.prompts[0]).toContain('I will add exponential backoff')
    expect(state.files.get(LEDGER_PATH)).toBe(
      '# Ledger\n\n## 2026-10-07\n\n'
      + '- 21:02 `src/link.swift` +2 −1 Added exponential backoff so reconnects stop flooding the proxy.\n',
    )
  })

  test('a Write counts against the previous file and appends under the same day', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Covered cap and reset', {
      [`${ROOT}/README.md`]: 'one\ntwo\n',
      [LEDGER_PATH]: '# Ledger\n\n## 2026-10-07\n\n- 20:00 `a.ts` +1 Earlier.\n',
    })
    await approveEdits($)

    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/README.md`, content: 'one\ntwo\nthree\n' })
    await clock.settle()

    expect(state.files.get(LEDGER_PATH)).toBe(
      '# Ledger\n\n## 2026-10-07\n\n- 20:00 `a.ts` +1 Earlier.\n- 21:02 `README.md` +1 Covered cap and reset.\n',
    )
  })

  test('a failed model call leaves "Reason unavailable"', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, null)
    await approveEdits($)
    await openLedger($)

    await $.tool.call(edit('a.ts', 'x', 'y'))
    await clock.settle()

    expect(await paneText($)).toContain('Reason unavailable')
    expect(state.files.get(LEDGER_PATH)).toContain('- 21:02 `a.ts` +1 −1 Reason unavailable\n')
  })

  test('an Edit the gate refuses records nothing', async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, 'Unused.')
    await openLedger($)

    const refused = await $.tool.call(edit('a.ts', 'x', 'y'))

    expect(refused.deny).toBeDefined()
    expect(await paneText($)).toContain('No changes recorded yet.')
  })
})

describe('what reaches the model', () => {
  test('a key in a change is masked before the why is asked', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Stored the key.')
    await approveEdits($)
    const key = `sk-proj-${'k'.repeat(24)}`
    await $.tool.call(edit('src/config.ts', 'const key = ""', `const key = "${key}"`))
    await clock.settle()
    expect(state.prompts[0]).toContain('[redacted secret]')
    expect(state.prompts[0]).not.toContain(key)
  })
})

describe('not in the approved plan', () => {
  const PLAN = '# Plan\n- `link.swift`: add a Backoff type\n'

  async function writeAndApprovePlan($: Engine) {
    await $.tool.call({ tool: 'Write', tool_use_id: 'plan-1', file_path: PLAN_PATH, content: PLAN })
    await $.command.run({ command: 'plan-review', args: '' })
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.press({ key: 'approve' })
    await ui.unmount()
  }

  test('flags a file the approved plan does not mention, by path or name', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Documented the retry setting.', { [PLAN_PATH]: PLAN })
    await writeAndApprovePlan($)

    await $.tool.call(edit('src/api/link.swift', 'a', 'b'))
    await $.tool.call(edit('README.md', 'a', 'b'))
    await clock.settle()

    const ledger = state.files.get(LEDGER_PATH)!
    expect(ledger).toContain('`src/api/link.swift` +1 −1 Documented the retry setting.\n')
    expect(ledger).toContain('`README.md` +1 −1 Documented the retry setting. **Not in the approved plan.**\n')
    await openLedger($)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    const flags = await ui.findAll({ type: 'Text', text: 'Not in the approved plan.' })
    expect(flags.filter(found => found.props.color === '#f2c14e')).toHaveLength(1)
    await ui.unmount()
  })

  test('does not flag while the plan is pending', async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, 'x', { [PLAN_PATH]: PLAN })
    await $.tool.call({ tool: 'Write', tool_use_id: 'plan-1', file_path: PLAN_PATH, content: PLAN })
    await approveEdits($)
    await openLedger($)

    await $.tool.call(edit('README.md', 'a', 'b'))

    expect(await paneText($)).not.toContain('Not in the approved plan.')
  })
})

describe('panel and commands', () => {
  test('draws entries and drafts a commit message on terminal and desktop', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, 'Add exponential backoff to the API host reconnects\n\nReconnects flooded the proxy.')
    await approveEdits($)
    await $.tool.call(edit('README.md', 'a', 'a\nb'))
    await clock.settle()
    await openLedger($)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: '.claude/ledger.md in this project' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'README.md' })).toBeDefined()
      expect((await ui.find({ key: 'draft' }))?.props.variant).toBe('primary')
      expect(await ui.find({ key: 'brain' })).toBeDefined()
      expect(await ui.find({ key: 'timeline' })).toBeDefined()

      await ui.press({ key: 'draft' })
      expect((await ui.find({ type: 'Code' }))?.text).toStartWith('Add exponential backoff to the API host reconnects')
      expect(await ui.find({ key: 'copy' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Save to brain opens the brain beside the ledger and hands the scribe the entries', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Fixed the retry.', { [`${HOME}/.claude/skills/notes-conventions/SKILL.md`]: '# Second Brain' })
    await approveEdits($)
    await $.tool.call(edit('a.ts', 'x', 'y'))
    await clock.settle()
    await openLedger($)

    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.press({ key: 'brain' })
    expect(state.spawned[0]).toContain('Ledger: a.ts +1 −1: Fixed the retry.')
    expect(await ui.find({ type: 'Text', text: '▍Second brain' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▍Ledger' })).toBeDefined()
  })

  test('Timeline writes the page and shows it in the companion', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const state = world(on, 'Fixed it.')
    await approveEdits($)
    await $.tool.call(edit('a.ts', 'x', 'y'))
    await clock.settle()
    await openLedger($)

    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
    await ui.press({ key: 'timeline' })
    // Written straight into the companion's folder: nothing lands in /tmp.
    expect([...state.files.keys()].some(path => path.startsWith('/tmp/'))).toBe(false)
    expect(state.files.get(`${HOME}/.claude/companion/views/ledger-timeline.html`)).toContain('a.ts')
    expect(state.toasts.some(toast => toast.startsWith('Showing "Ledger timeline" in the companion.'))).toBe(true)
  })

  test('draws plain text on vscode and mobile', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, 'Fixed it.')
    await approveEdits($)
    await $.tool.call(edit('a.ts', 'x', 'y'))
    await clock.settle()
    await openLedger($)

    for (const surface of PLAIN_SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: '21:02 a.ts +1 −1: Fixed it.' })).toBeDefined()
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      await ui.unmount()
    }
  })

  test('/ledger commit-message returns the drafted text with a subject of at most 72 characters', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, 'Add exponential backoff to the API host so reconnect attempts stop flooding the proxy\n\nBody line.')
    await approveEdits($)
    await $.tool.call(edit('a.ts', 'x', 'y'))
    await clock.settle()

    const { text } = await $.command.run({ command: 'ledger', args: 'commit-message' })
    const [subject] = text!.split('\n')
    expect(subject).toBe('Add exponential backoff to the API host so reconnect attempts stop')
    expect(text).toContain('Body line.')
  })
})
