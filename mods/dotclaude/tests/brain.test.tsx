import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addCaptureLine, appendDatedSection, capturePreview, codeWarnings, isAllowedNotePath, neutraliseBody } from '../hooks/features/brain/notes'
import { parseScribeAnswer } from '../hooks/features/brain/scribe'
import { countCaptures, obsidianUrl, relativeTime } from '../hooks/features/brain/vault'
import { answerUi, WORKSPACE } from './host'

// A virtual home: every $.fs and $.process call is answered from memory, so no real vault is ever touched.
const HOME = '/tmp/brain-fixture'
// The default vaultPath, ~/Notes.
const VAULT = `${HOME}/Notes`
const NOW = new Date(2026, 9, 7, 21, 30).getTime()
const MINUTE = 60_000

// The brain is a side panel: the workspace draws it beside the vitals.
const PANE = WORKSPACE

type File = { text: string; mtimeMs: number }

function fixtureFiles(): Map<string, File> {
  const file = (text: string, minutesAgo: number): File => ({ text, mtimeMs: NOW - minutesAgo * MINUTE })
  return new Map([
    [`${HOME}/.claude/skills/notes-conventions/SKILL.md`, file('# Second Brain\nUse [[wikilinks]].', 9000)],
    [`${VAULT}/inbox/API backoff decision.md`, file('8 s cap for API clients', 2)],
    [`${VAULT}/inbox/Changelog draft.md`, file('added, fixed, changed', 60 * 26)],
    [`${VAULT}/notes/API Patterns.md`, file('---\ncreated: 2026-07-06\n---\n\n# API Patterns\n\nReconnect with backoff.\n', 60)],
    [`${VAULT}/notes/Reading list.md`, file('Profile hub', 600)],
    [`${VAULT}/daily/2026-10-07.md`, file('# 2026-10-07\n\n## Session log\n\n- 20:43 — mods\n\n## Captures\n\n- 20:00 — first\n', 5)],
    [`${VAULT}/.obsidian/app.json`, file('{}', 9000)],
  ])
}

// The host's toast record of the running test, set by mockVault.
let toasts: string[] = []
const opened: string[] = []
const START = { cwd: '/Users/user/Projects/my-project', surface: 'terminal', isInteractive: true } as const

const isUnder = (path: string, dir: string) => path.startsWith(`${dir}/`)

/** Answers the file system and the two search commands from the in-memory vault. */
function mockVault(on: On, files: Map<string, File>, env: Record<string, string> = {}, links: readonly string[] = []) {
  const ui = answerUi(on)
  toasts = ui.toasts
  opened.length = 0
  mock.env(on, { HOME, ...env })
  const clock = mock.clock(on, { now: NOW })
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) || [...files.keys()].some(path => isUnder(path, e.path)) }))
  on('fs.read', (_$, e) => {
    const found = files.get(e.path)
    return found ? { value: found.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, { text: e.text, mtimeMs: NOW })
    return { value: undefined }
  })
  on('fs.list', (_$, e) => ({
    value: [...files.entries()]
      .filter(([path]) => isUnder(path, e.path) && !path.slice(e.path.length + 1).includes('/'))
      .map(([path, found]) => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: found.text.length, mtimeMs: found.mtimeMs, isLink: false })),
  }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'open') {
      opened.push(e.argv[1])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const notes = [...files.keys()].filter(path => isUnder(path, VAULT) && path.endsWith('.md'))
    const query = e.argv.at(-2)?.toLowerCase() ?? ''
    const lines = e.argv[0] === 'find' ? notes : notes.filter(path => files.get(path)!.text.toLowerCase().includes(query))
    const exitCode = e.argv[0] === 'grep' && lines.length === 0 ? 1 : 0
    return { value: { exitCode, stdout: lines.join('\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Ok, we keep the 8 s cap for all API clients', toolUses: [] },
      { role: 'assistant' as const, text: 'Noted. Backoff merged and tested on the bench unit.', toolUses: [] },
    ],
  }))
  on('session.cwd', () => ({ value: '/Users/user/Projects/my-project' }))
  on('session.root', () => ({ value: '/Users/user/Projects/my-project' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  // Only the listed paths answer a stat: as symbolic links. Everything else reads as absent.
  on('fs.stat', (_$, e) =>
    links.includes(e.path) ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: true } } : { deny: `ENOENT: ${e.path}` },
  )
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return clock
}

/** Answers the save question (and any other) with `answer`; the asked questions, in order. */
function answerSave(on: On, answer: string): string[] {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0].question
    asked.push(question)
    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  return asked
}

/** A capture through the fallback model call, the scribe answering `answer`. */
async function captureWith($: Parameters<Parameters<typeof test>[1]>[0], on: On, answer: object) {
  on('agent.spawn', () => ({ deny: 'agents are off' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify(answer), usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) as never)
  await $.session.start(START)
  await $.command.run({ command: 'brain', args: 'capture' } as never)
}

const DRAFT = {
  notes: [{ path: 'notes/API Patterns.md', title: 'API Patterns', tags: ['api'], body: 'Backoff capped at 8 s.' }],
  dailyLine: 'API backoff cap decided',
  questions: [{ id: 'q1', question: 'Is the 8 s cap for all API work or this project only?', options: ['All API work', 'This project only'] }],
}
const FINAL = {
  notes: [
    { path: 'notes/API Patterns.md', title: 'API Patterns', tags: ['api'], body: 'Backoff capped at 8 s for all API clients.' },
    { path: 'projects/Project Sync.md', title: 'Project Sync', tags: ['project/my-project'], body: 'Uses [[API Patterns]].' },
  ],
  dailyLine: 'API backoff cap decided for all API work',
  questions: [],
}

describe('vault helpers', () => {
  test('relative time, links and capture counts', async () => {
    expect(relativeTime(NOW - 2 * MINUTE, NOW)).toBe('2 min ago')
    expect(relativeTime(NOW - 26 * 60 * MINUTE, NOW)).toBe('yesterday')
    expect(obsidianUrl('Notes', 'notes/API Patterns.md')).toBe(
      'obsidian://open?vault=Notes&file=notes%2FAPI%20Patterns',
    )
    expect(countCaptures('## Session log\n\n- a\n\n## Captures\n\n- b\n- c\n')).toBe(2)
  })

  test('note paths stay inside the note folders', async () => {
    expect(isAllowedNotePath('notes/API Patterns.md')).toBe(true)
    expect(isAllowedNotePath('daily/2026-10-07.md')).toBe(false)
    expect(isAllowedNotePath('notes/../../etc/passwd.md')).toBe(false)
    expect(isAllowedNotePath('/Users/user/notes/x.md')).toBe(false)
  })

  test('appending never drops what the note holds', async () => {
    const before = '# API Patterns\n\nReconnect with backoff.\n'
    const after = appendDatedSection(before, 'Cap at 8 s.', '2026-10-07')
    expect(after).toStartWith('# API Patterns\n\nReconnect with backoff.')
    expect(after).toEndWith('## 2026-10-07\n\nCap at 8 s.\n')
    expect(addCaptureLine('# d\n\n## Captures\n\n- one\n\n## Later\n', '- two')).toBe('# d\n\n## Captures\n\n- one\n- two\n\n## Later\n')
  })

  test('the scribe answer is read even with a stray sentence around it', async () => {
    const answer = parseScribeAnswer(`Here it is:\n${JSON.stringify(DRAFT)}`)
    expect(answer.questions[0].options).toEqual(['All API work', 'This project only'])
    expect(() => parseScribeAnswer('no json')).toThrow('did not answer with JSON')
  })
})

test('the pane lists the vault and searches it on terminal and desktop', async ($, on) => {
  const files = fixtureFiles()
  const clock = mockVault(on, files)
  await $.session.start(START)
  await $.command.run({ command: 'brain', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const noteType = surface === 'terminal' ? 'Link' : 'Button'
    expect(await ui.find({ type: noteType, text: 'API backoff decision' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 min ago' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 capture' })).toBeDefined()
    expect(await ui.find({ type: noteType, text: 'API Patterns' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'Capture this session' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'search', text: 'clients' })
  const results = await ui.findAll({ type: 'Link', text: 'API backoff decision' })
  expect(results[0]?.props.href).toBe('obsidian://open?vault=Notes&file=inbox%2FAPI%20backoff%20decision')
  expect(results).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'Results' })).toBeDefined()
  await ui.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desktop.press({ key: 'inbox:inbox/API backoff decision.md' })
  expect(opened).toEqual(['obsidian://open?vault=Notes&file=inbox%2FAPI%20backoff%20decision'])
  await desktop.unmount()

  for (const surface of ['vscode', 'mobile'] as const) {
    const plain = await $.ui.mount({ ...PANE, surface })
    expect(await plain.find({ type: 'Text', text: /2 in inbox, 1 captures today/ })).toBeDefined()
    await plain.unmount()
  }
})

test('a capture with one question asks, finalizes and saves without overwriting', async ($, on) => {
  const files = fixtureFiles()
  const clock = mockVault(on, files)
  const prompts: string[] = []
  const asked: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    const agentId = `scribe-${prompts.length}`
    // The kit reads a spawned agent's id from `result`, as the Agent tool reports it.
    return { model: 'sonnet', agentId, result: { agentId } } as never
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = (e as unknown as { questions: { question: string }[] }).questions[0].question
    asked.push(question)
    const answer = question.startsWith('Save these notes?') ? 'Save' : 'All API work'
    return { result: { questions: [], answers: { [question]: answer } } } as never
  })
  await $.session.start(START)
  await $.command.run({ command: 'brain', args: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'capture' })
  expect(prompts[0]).toContain('Ok, we keep the 8 s cap for all API clients')
  expect(prompts[0]).toContain('Use [[wikilinks]].')
  expect(await ui.find({ type: 'Text', text: 'Scribe is reading the session…' })).toBeDefined()

  const turn = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
  await $.turn.complete({ ...turn, agentId: 'scribe-1', answer: JSON.stringify(DRAFT) })
  await clock.settle()
  expect(asked[0]).toBe('Is the 8 s cap for all API work or this project only?')
  expect(prompts[1]).toContain('The user answered: All API work')

  await $.turn.complete({ ...turn, agentId: 'scribe-2', answer: JSON.stringify(FINAL) })
  await clock.settle()

  const patterns = files.get(`${VAULT}/notes/API Patterns.md`)!.text
  expect(patterns).toStartWith('---\ncreated: 2026-07-06\n---\n\n# API Patterns\n\nReconnect with backoff.')
  expect(patterns).toEndWith('## 2026-10-07\n\nBackoff capped at 8 s for all API clients.\n')
  const project = files.get(`${VAULT}/projects/Project Sync.md`)!.text
  expect(project).toStartWith('---\ncreated: 2026-10-07\ntags: [project/my-project]\nsource: Claude Code session in my-project, 2026-10-07\n---\n\n# Project Sync')
  const daily = files.get(`${VAULT}/daily/2026-10-07.md`)!.text
  expect(daily).toContain('## Session log\n\n- 20:43 — mods')
  expect(daily).toEndWith('- 20:00 — first\n- 21:30 — API backoff cap decided for all API work [[API Patterns]] [[Project Sync]]\n')

  expect(toasts).toContain('Saved to notes/API Patterns.md and 2 more')

  const saved = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await saved.find({ type: 'Text', text: 'Saved' })).toBeDefined()
  expect(await saved.find({ type: 'Button', text: 'Project Sync' })).toBeDefined()
  expect(await saved.find({ type: 'Button', text: 'Capture again' })).toBeDefined()
  expect(await saved.find({ type: 'Text', text: '2 captures' })).toBeDefined()
  await saved.unmount()
  await ui.unmount()
})

test('a dismissed question cancels the capture and writes nothing', async ($, on) => {
  const files = fixtureFiles()
  const clock = mockVault(on, files)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'scribe-1', result: { agentId: 'scribe-1' } }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'dismissed' }))
  await $.session.start(START)

  await $.command.run({ command: 'brain', args: 'capture the API decision' } as never)
  await clock.settle()
  const before = new Map(files)
  await $.turn.complete({ durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: 'scribe-1', answer: JSON.stringify(DRAFT) })
  await clock.settle()

  expect([...files.entries()]).toEqual([...before.entries()])
  expect(toasts).toContain('Capture cancelled')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: 'Capture this session' })).toBeDefined()
  await ui.unmount()
})

test('without an agent the scribe falls back to one model call', async ($, on) => {
  const files = fixtureFiles()
  const clock = mockVault(on, files)
  on('agent.spawn', () => ({ deny: 'agents are off' }))
  answerSave(on, 'Save')
  on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify({ ...FINAL, notes: [FINAL.notes[1]] }), usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) as never)
  await $.session.start(START)

  await $.command.run({ command: 'brain', args: 'capture' } as never)
  await clock.settle()
  expect(files.get(`${VAULT}/projects/Project Sync.md`)?.text).toContain('Uses [[API Patterns]].')
})

describe('configuration', () => {
  /** The prompt the scribe is handed when a capture starts, with `files` and `env` as the host. */
  async function scribePrompt($: Parameters<Parameters<typeof test>[1]>[0], on: On, files: Map<string, File>, env: Record<string, string> = {}) {
    const clock = mockVault(on, files, env)
    const prompts: string[] = []
    on('agent.spawn', (_$, e) => {
      prompts.push(e.prompt)
      return { model: 'sonnet', agentId: 'scribe-1', result: { agentId: 'scribe-1' } } as never
    })
    await $.session.start(START)
    await $.command.run({ command: 'brain', args: 'capture' } as never)
    await clock.settle()
    return prompts[0] ?? ''
  }

  test('a missing vault folder is said plainly, with no capture offered', async ($, on) => {
    const files = new Map([...fixtureFiles()].filter(([path]) => !path.startsWith(VAULT)))
    mockVault(on, files)
    await $.session.start(START)
    await $.command.run({ command: 'brain', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: `No notes vault at ${VAULT}. Set vaultPath in the plugin's options (/config) to your notes folder.` })).toBeDefined()
    expect(await ui.find({ key: 'capture' })).toBeUndefined()
  })

  test('without a conventions skill the scribe follows built-in conventions', async ($, on) => {
    const files = new Map([...fixtureFiles()].filter(([path]) => !path.includes('/skills/')))
    const prompt = await scribePrompt($, on, files)
    expect(prompt).toContain('## Note conventions')
    expect(prompt).toContain('Every note starts with YAML frontmatter')
  })

  test('the skill is looked up in CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
    const files = fixtureFiles()
    files.set('/cfg/skills/notes-conventions/SKILL.md', { text: 'Conventions from the config dir.', mtimeMs: NOW })
    const prompt = await scribePrompt($, on, files, { CLAUDE_CONFIG_DIR: '/cfg' })
    expect(prompt).toContain('Conventions from the config dir.')
    expect(prompt).not.toContain('Use [[wikilinks]].')
  })

  test('the conventionsSkill option names the skill the scribe follows', { options: { conventionsSkill: 'my-vault-rules' } }, async ($, on) => {
    const files = fixtureFiles()
    files.set(`${HOME}/.claude/skills/my-vault-rules/SKILL.md`, { text: 'Rules from my-vault-rules.', mtimeMs: NOW })
    const prompt = await scribePrompt($, on, files)
    expect(prompt).toContain('Rules from my-vault-rules.')
    expect(prompt).not.toContain('Use [[wikilinks]].')
  })

  test('vaultPath and vaultName options point at another vault', { options: { vaultPath: '/srv/vault', vaultName: 'Work' } }, async ($, on) => {
    const files = new Map([...fixtureFiles()].map(([path, file]) => [path.replace(VAULT, '/srv/vault'), file] as const))
    mockVault(on, files)
    await $.session.start(START)
    await $.command.run({ command: 'brain', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const link = await ui.find({ type: 'Link', text: 'API backoff decision' })
    expect(link?.props.href).toBe('obsidian://open?vault=Work&file=inbox%2FAPI%20backoff%20decision')
  })
})

test('a key in the session is masked before the scribe reads it', async ($, on) => {
  const files = fixtureFiles()
  const clock = mockVault(on, files)
  const token = `ghp_${'t'.repeat(30)}`
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'sonnet', agentId: 'scribe-1', result: { agentId: 'scribe-1' } } as never
  })
  await $.session.start(START)
  await $.command.run({ command: 'brain', args: `capture the deploy token ${token}` } as never)
  await clock.settle()
  expect(prompts[0]).toContain('[redacted secret]')
  expect(prompts[0]).not.toContain(token)
})

describe('saving safely', () => {
  test('the notes are shown and saved only on Save', async ($, on) => {
    const files = fixtureFiles()
    const clock = mockVault(on, files)
    const asked = answerSave(on, 'Cancel')
    await captureWith($, on, FINAL)
    await clock.settle()
    expect(asked[0]).toContain('Save these notes?')
    expect(asked[0]).toContain('- projects/Project Sync.md\n    Uses [[API Patterns]].')
    expect(asked[0]).toContain('Daily note: API backoff cap decided for all API work')
    expect(files.has(`${VAULT}/projects/Project Sync.md`)).toBe(false)
    expect(toasts).toContain('Capture not saved')
  })

  test('titles, tags and the daily line are held to one line', async ($, on) => {
    const files = fixtureFiles()
    const clock = mockVault(on, files)
    answerSave(on, 'Save')
    await captureWith($, on, {
      notes: [{ path: 'notes/Clean.md', title: 'Clean\n---\nevil: yes', tags: ['a\nb', '\u0007'], body: 'Body.' }],
      dailyLine: 'line one\n## injected',
      questions: [],
    })
    await clock.settle()
    const note = files.get(`${VAULT}/notes/Clean.md`)!.text
    expect(note).toContain('# Clean --- evil: yes')
    expect(note).toContain('tags: [a b]')
    expect(files.get(`${VAULT}/daily/2026-10-07.md`)!.text).toContain('— line one ## injected')
  })

  test('the question shows each body in full, a long one up to 40 lines', async () => {
    const long = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n')
    const preview = capturePreview({
      notes: [
        { path: 'notes/Short.md', title: 'Short', tags: [], body: 'One.\n\nTwo.\nThree.' },
        { path: 'notes/Long.md', title: 'Long', tags: [], body: long },
      ],
      dailyLine: 'd',
      questions: [],
    })
    expect(preview).toContain('- notes/Short.md\n    One.\n\n    Two.\n    Three.')
    expect(preview).toContain('    line 40\n    +5 more lines')
    expect(preview).not.toContain('line 41')
  })

  test('code blocks are flagged; runnable dataviewjs and Templater parts are made inert', async () => {
    const body = ['```dataviewjs', 'dv.paragraph(1)', '```', 'Inline `$= dv.current()` and <% tp.date.now() %>.'].join('\n')
    expect(neutraliseBody(body)).toBe(['```text', 'dv.paragraph(1)', '```', 'Inline `\\$= dv.current()` and &lt;% tp.date.now() %>.'].join('\n'))
    expect(codeWarnings(body)).toEqual([
      '⚠ Holds dataviewjs or Templater code: it is saved as plain text, so it cannot run.',
      '⚠ Holds JavaScript code blocks: read them before saving.',
    ])
    expect(codeWarnings('```javascript\nx()\n```')).toEqual(['⚠ Holds JavaScript code blocks: read them before saving.'])
    expect(codeWarnings('~~~python\nx()\n~~~')).toEqual(['⚠ Holds code blocks: read them before saving.'])
    expect(codeWarnings('Plain prose with `code`.')).toEqual([])
    expect(neutraliseBody('```js\nx()\n```')).toBe('```js\nx()\n```')
  })

  test('the question warns about code, and what is saved cannot run', async ($, on) => {
    const files = fixtureFiles()
    const clock = mockVault(on, files)
    const asked = answerSave(on, 'Save')
    await captureWith($, on, {
      notes: [{ path: 'notes/Query.md', title: 'Query <% tp.file.title %>', tags: [], body: '```dataviewjs\ndv.list([1])\n```' }],
      dailyLine: 'ran <% tp.user.x() %>',
      questions: [],
    })
    await clock.settle()
    expect(asked[0]).toContain('- notes/Query.md\n  ⚠ Holds dataviewjs or Templater code: it is saved as plain text, so it cannot run.')
    expect(asked[0]).toContain('    ```text\n    dv.list([1])')
    const note = files.get(`${VAULT}/notes/Query.md`)!.text
    expect(note).toContain('```text\ndv.list([1])\n```')
    expect(note).toContain('# Query &lt;% tp.file.title %>')
    expect(note).not.toContain('dataviewjs')
    expect(files.get(`${VAULT}/daily/2026-10-07.md`)!.text).toContain('ran &lt;% tp.user.x() %>')
  })

  test('hidden folders and links in the vault are refused', async ($, on) => {
    expect(isAllowedNotePath('notes/.obsidian/x.md')).toBe(false)
    expect(isAllowedNotePath('notes/.hidden.md')).toBe(false)
    const files = fixtureFiles()
    const clock = mockVault(on, files, {}, [`${VAULT}/projects`])
    answerSave(on, 'Save')
    await captureWith($, on, FINAL)
    await clock.settle()
    expect(files.has(`${VAULT}/projects/Project Sync.md`)).toBe(false)
    expect(toasts.some(toast => toast.includes('goes through a symbolic link'))).toBe(true)
  })
})
