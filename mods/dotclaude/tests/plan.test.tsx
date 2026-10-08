import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'

const PLAN_PATH = '/work/app/docs/plans/api-backoff.md'
const PLAN_TEXT = '# API backoff\n\n## Goal\nReconnect.\n\n## Changes\nAdd Backoff.\n\n## Verification\nxcodebuild test'
const CODE_PATH = '/work/app/Sources/link.swift'

// The world beneath the plugin: what it submitted and showed.
function world(on: On, planText = PLAN_TEXT) {
  const ui = answerUi(on)
  const prompts: string[] = []
  mock.env(on, { HOME: '/home/user' })
  mock.clock(on, { now: 1000 })
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: planText }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', (_$, e) => ({
    result: { type: 'create', filePath: (e as { file_path?: string }).file_path, content: PLAN_TEXT, structuredPatch: [], originalFile: null },
  }))
  return { ui, prompts }
}

async function writeFile($: Engine, path: string) {
  await $.tool.call({ tool: 'Write', tool_use_id: 'use-1', file_path: path, content: PLAN_TEXT })
}

async function openReview($: Engine) {
  await $.command.run({ command: 'plan-review', args: '' })
}

test('a write to a plan path is recorded as pending', async ($, on) => {
  world(on)
  await writeFile($, PLAN_PATH)
  await openReview($)

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Waiting for you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'api-backoff.md' })).toBeDefined()
})

test('a plan outside the project, or written through a symbolic link, is not picked up', async ($, on) => {
  world(on)
  on('fs.stat', (_$, e) =>
    e.path === PLAN_PATH ? { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: true } } : { deny: `ENOENT ${e.path}` },
  )
  await writeFile($, '/elsewhere/docs/plans/other.md')
  await writeFile($, PLAN_PATH)
  const { text } = await $.command.run({ command: 'plan-review', args: '' })
  expect(text).toBe('No plan yet. One shows up here when Claude writes a plan or spec.')
})

test('a write outside the plan paths is ignored', async ($, on) => {
  world(on)
  await $.command.run({ command: 'gate', args: 'approve' })
  await writeFile($, CODE_PATH)
  const { text } = await $.command.run({ command: 'plan-review', args: '' })
  expect(text).toBe('No plan yet. One shows up here when Claude writes a plan or spec.')
})

test('the plan row draws a review card on terminal and desktop', async ($, on) => {
  world(on)
  await writeFile($, PLAN_PATH)
  const row = { tool_use_id: 'use-1', tool: 'Write', input: { file_path: PLAN_PATH }, isRunning: false, isErrored: false, isInterrupted: false }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dotclaude', surface, component: 'ToolUse', requestId: 'use-1', props: row })
    expect(await ui.find({ type: 'Text', text: 'Plan ready for your review' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'api-backoff.md, 3 sections' })).toBeDefined()
    expect((await ui.find({ key: 'review' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'companion' })).toBeDefined()
    await ui.unmount()
  }
})

test('Review plan opens the plan beside the main column', async ($, on) => {
  world(on)
  await writeFile($, PLAN_PATH)
  const row = { tool_use_id: 'use-1', tool: 'Write', input: { file_path: PLAN_PATH }, isRunning: false, isErrored: false, isInterrupted: false }
  const card = await $.ui.mount({ plugin: 'dotclaude', surface: 'terminal', component: 'ToolUse', requestId: 'use-1', props: row })
  await card.press({ key: 'review' })
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  expect(await ui.find({ type: 'Markdown', text: /## Changes/ })).toBeDefined()
})

test('approve marks the plan approved and unlocks edits through the gate, no command run', async ($, on) => {
  const { ui: host } = world(on)
  await writeFile($, PLAN_PATH)
  await openReview($)
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  await ui.press({ key: 'approve' })

  expect(host.toasts).toEqual(['Plan approved, edits unlocked'])
  expect(host.commandsRun).toEqual([])
  expect(await ui.find({ type: 'Text', text: /● Approved/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Edits open' })).toBeDefined()
  const edited = await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: CODE_PATH, old_string: 'a', new_string: 'b' })
  expect(edited.deny).toBeUndefined()
})

test('request changes submits the comment to Claude', async ($, on) => {
  const { ui: host, prompts } = world(on)
  await writeFile($, PLAN_PATH)
  await openReview($)
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  await ui.input({ key: 'comment', text: 'Cap the backoff at 30 s', kind: 'change' })
  await ui.press({ key: 'changes' })

  expect(prompts).toEqual(['Changes requested on api-backoff.md: Cap the backoff at 30 s'])
  expect(host.toasts).toEqual(['Comment sent to Claude'])
  expect(await ui.find({ type: 'Text', text: /Changes requested/ })).toBeDefined()
})

test('request changes without a comment points Claude at the plan', async ($, on) => {
  const { prompts } = world(on)
  await writeFile($, PLAN_PATH)
  await openReview($)
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
  await ui.press({ key: 'changes' })

  expect(prompts).toEqual(['Changes requested on api-backoff.md: see plan'])
})

test('the panel draws the plan on terminal and desktop, plain text elsewhere', async ($, on) => {
  world(on)
  await writeFile($, PLAN_PATH)
  await openReview($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...WORKSPACE, surface })
    expect(await ui.find({ type: 'Text', text: /Waiting for you/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /## Changes/ })).toBeDefined()
    expect(await ui.find({ key: 'comment' })).toBeDefined()
    await ui.unmount()
  }
  for (const surface of PLAIN_SURFACES) {
    const ui = await $.ui.mount({ ...WORKSPACE, surface })
    expect(await ui.find({ type: 'Text', text: /api-backoff.md: Waiting for you/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a long plan is drawn one part at a time', async ($, on) => {
  const long = `## One\n${'a'.repeat(29_000)}\n## Two\n${'b'.repeat(29_000)}`
  world(on, long)
  await writeFile($, PLAN_PATH)
  await openReview($)
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Part 1 of 2/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Markdown', text: /^b+$/ })).toBeDefined()
})

test('/plan-review says so when there is no plan yet', async ($, on) => {
  world(on)
  const { text } = await $.command.run({ command: 'plan-review', args: '' })
  expect(text).toBe('No plan yet. One shows up here when Claude writes a plan or spec.')
})
