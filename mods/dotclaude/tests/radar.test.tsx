import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'
import { MODEL_REPLY, TRANSCRIPT } from './radar-fixtures'

const HOME = '/home/user'
const CLAUDE = `${HOME}/.claude`
const BIG_SESSION = `${CLAUDE}/projects/-demo-app/big.jsonl`
// Radar is a side panel: the workspace draws it beside the vitals.
const PANE = WORKSPACE

type World = { store: Map<string, unknown>; submitted: string[]; tailed: string[][]; prompts: string[] }

function entry(name: string, kind: 'file' | 'dir', size = 0, mtimeMs = 0) {
  return { name, kind, size, mtimeMs, isLink: false }
}

// The machine beneath the plugin: one small and one oversized transcript,
// a vault, installed skills, and a model that answers with MODEL_REPLY.
// `claude` is Claude Code's folder: ~/.claude, or what CLAUDE_CONFIG_DIR names.
function world(on: On, reply: string = MODEL_REPLY, claude = CLAUDE): World {
  const store = new Map<string, unknown>([['dismissed', ['old-idea']]])
  const submitted: string[] = []
  const tailed: string[][] = []
  const prompts: string[] = []
  const dirs: Record<string, ReturnType<typeof entry>[]> = {
    [`${claude}/projects`]: [entry('-demo-app', 'dir')],
    [`${claude}/projects/-demo-app`]: [entry('small.jsonl', 'file', 2_000, 2), entry('big.jsonl', 'file', 9_000_000, 1)],
    [`${HOME}/Notes/notes`]: [entry('Reading list.md', 'file')],
    [`${claude}/skills`]: [entry('plan-gate', 'dir')],
    [`${claude}/agents`]: [entry('code-reviewer.md', 'file')],
  }
  answerUi(on)
  mock.env(on, claude === CLAUDE ? { HOME } : { HOME, CLAUDE_CONFIG_DIR: claude })
  mock.clock(on, { now: Date.UTC(2026, 9, 7) })
  // The calls on `$` are answered `{ value }`, as the host beneath them answers.
  on('fs.exists', ($, e) => ({ value: e.path in dirs }))
  on('fs.list', ($, e) => ({ value: dirs[e.path] ?? [] }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/-demo-app/big.jsonl')) throw new Error('over 4 MiB')
    return { value: TRANSCRIPT }
  })
  on('process.run', ($, e) => {
    tailed.push([...e.argv])
    return { value: { exitCode: 0, stdout: TRANSCRIPT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.list', () => ({ value: [{ name: 'caveman', description: '', source: 'plugin' as const }] }))
  on('model.complete', ($, e) => {
    prompts.push(e.prompt)
    const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    return { value: { isAnswered: true as const, text: reply, usage } }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return { store, submitted, tailed, prompts }
}

function openRadar($: Engine) {
  return $.command.run({
    command: 'radar',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

test('before a scan the pane shows the intro and Scan now', async ($, on) => {
  world(on)
  await openRadar($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /repeated work/ })).toBeDefined()
    expect((await ui.find({ key: 'scan' }))?.props.variant).toBe('primary')
    await ui.unmount()
  }
})

test('a scan reads transcripts, tails the big one, and draws filtered cards', async ($, on) => {
  const { store, tailed, prompts } = world(on)
  await openRadar($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'scan' })
    expect(await ui.find({ type: 'Text', text: 'From 2 sessions and your vault, scanned 2026-10-07.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Release notes drafting' })).toBeDefined()
    expect(await ui.find({ key: 'draft-quick-deploy' })).toBeDefined()
    // Already installed and already dismissed ideas are not drawn.
    expect(await ui.find({ key: 'draft-plan-gate' })).toBeUndefined()
    expect(await ui.find({ key: 'draft-old-idea' })).toBeUndefined()
    await ui.unmount()
  }
  expect(tailed[0]).toEqual(['tail', '-c', String(3 * 1024 * 1024), BIG_SESSION])
  expect(prompts[0]).toContain('Write release notes for version 2.3')
  expect(prompts[0]).toContain('Reading list')
  expect((store.get('lastScan') as { sessionCount: number }).sessionCount).toBe(2)
})

test('Draft submits a brainstorm prompt for that idea', async ($, on) => {
  const { submitted } = world(on)
  await openRadar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'scan' })
  await ui.press({ key: 'draft-release-notes' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Radar suggests a new skill: "Release notes drafting"')
  expect(submitted[0]).toContain('ask me where to create it')
  await ui.unmount()
})

test('Later moves a card under Later; Dismiss stores its id', async ($, on) => {
  const { store } = world(on)
  await openRadar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'scan' })
  await ui.press({ key: 'later-quick-deploy' })
  expect(await ui.find({ type: 'Text', text: /^Later$/ })).toBeDefined()
  expect(await ui.find({ key: 'later-quick-deploy' })).toBeUndefined()
  expect((store.get('later') as { id: string }[]).map(idea => idea.id)).toEqual(['quick-deploy'])

  await ui.press({ key: 'dismiss-quick-deploy' })
  expect(await ui.find({ key: 'draft-quick-deploy' })).toBeUndefined()
  expect(store.get('dismissed')).toEqual(['old-idea', 'quick-deploy'])
  expect(store.get('later')).toEqual([])
  await ui.unmount()
})

test('an unreadable model reply is shown in plain words', async ($, on) => {
  world(on, 'I could not decide.')
  await openRadar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'scan' })
  expect(await ui.find({ type: 'Text', text: /not the JSON Radar asked for/ })).toBeDefined()
  expect(await ui.find({ key: 'scan' })).toBeDefined()
  await ui.unmount()
})

test('vscode and mobile get plain text', async ($, on) => {
  world(on)
  await openRadar($)
  for (const surface of PLAIN_SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /terminal or the desktop app/ })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('sessions, skills and agents are read from CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  const { tailed, prompts } = world(on, MODEL_REPLY, '/cfg')
  await openRadar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'scan' })
  expect(tailed[0]?.[3]).toBe('/cfg/projects/-demo-app/big.jsonl')
  expect(prompts[0]).toContain('code-reviewer')
})
