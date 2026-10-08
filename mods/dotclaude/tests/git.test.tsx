import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isForcePush } from '../hooks/features/git/plan'
import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'

const ROOT = '/work/app'

type World = { files: string; asked: string[]; answer: (question: string) => string; ran: string[][]; fsmonitorOff: boolean[] }

function ok(stdout = '') {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

function fail(stderr: string) {
  return { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

/** A repo on main tracking origin, with gh signed in; every command is recorded, none really runs. */
function answerGit(world: World, argv: readonly string[]) {
  const command = argv.join(' ')
  if (command === 'git rev-parse --show-toplevel') return ok(`${ROOT}\n`)
  if (command === 'git branch --show-current') return ok('main\n')
  if (command === 'git status --porcelain -uall') return ok(world.files)
  if (command === 'git remote -v') {
    return ok('origin\tgit@github.com:octocat/app.git (fetch)\norigin\tgit@github.com:octocat/app.git (push)\n')
  }
  if (command.startsWith('git for-each-ref')) return ok('main\n')
  if (command.startsWith('git rev-parse --abbrev-ref')) return ok('origin/main\n')
  if (command.startsWith('git rev-list')) return ok('0\t1\n')
  if (command === 'gh auth status') return ok()
  if (command.startsWith('gh repo list')) {
    return ok(JSON.stringify([{ nameWithOwner: 'octocat/app', isPrivate: true, url: 'https://github.com/octocat/app' }]))
  }
  if (command.startsWith('git check-ref-format --branch')) return argv[3]?.includes('..') ? fail('fatal') : ok(argv[3])
  return ok()
}

/** The world beneath the plugin; `override` answers a command before the normal repo does. */
function engine(on: On, world: World, override?: (argv: readonly string[]) => ReturnType<typeof ok> | undefined) {
  answerUi(on)
  const clock = mock.clock(on)
  on('process.run', ($, e) => {
    // Every git call must run with the fsmonitor hook off; the rest of the test reads it without.
    const isGit = e.argv[0] === 'git'
    if (isGit) world.fsmonitorOff.push(e.argv[1] === '-c' && e.argv[2] === 'core.fsmonitor=false')
    const argv = isGit && e.argv[1] === '-c' ? ['git', ...e.argv.slice(3)] : [...e.argv]
    world.ran.push(argv)
    return { value: override?.(argv) ?? answerGit(world, argv) }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = (e.questions as { question: string }[])[0]?.question ?? ''
    world.asked.push(question)
    // Recorded beside the commands, so a test can see the question came before any write.
    world.ran.push(['ask'])
    return { result: { questions: e.questions, answers: { [question]: world.answer(question) } } }
  })
  return clock
}

function newWorld(files: string, answer: (question: string) => string): World {
  return { files, asked: [], answer, ran: [], fsmonitorOff: [] }
}

async function openPanel($: Engine, clock: ReturnType<typeof mock.clock>) {
  await $.command.run({ command: 'git-panel', args: '' })
  await clock.advance(0)
}

const pushes = (world: World) => world.ran.filter(argv => argv[0] === 'git' && argv[1] === 'push')

describe('pane', () => {
  test('draws on terminal and desktop with the right primary label', async ($, on) => {
    const world = newWorld(' M hooks/a.ts\n', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'hooks/a.ts' })).toBeDefined()
      await ui.input({ key: 'message', text: 'Fix it', kind: 'change' })
      expect((await ui.find({ key: 'primary' }))?.text).toBe('↑ Commit and push')
      await ui.unmount()
    }
  })

  test('says Push when there is nothing to commit', async ($, on) => {
    const world = newWorld('', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect((await ui.find({ key: 'primary' }))?.text).toBe('↑ Push')
  })

  test('falls back to plain text on vscode and mobile', async ($, on) => {
    const world = newWorld('', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    for (const surface of PLAIN_SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: /Branch main/ })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('pushing', () => {
  test('asks before pushing, and a Cancel pushes nothing', async ($, on) => {
    const world = newWorld('', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.press({ key: 'primary' })
    expect(world.asked).toHaveLength(1)
    expect(world.asked[0]).toContain('branch main')
    expect(pushes(world)).toHaveLength(0)
  })

  test('confirmed, it commits with the co-author line and pushes without force', async ($, on) => {
    const world = newWorld(' M hooks/a.ts\n', question => (question.startsWith('Push') ? 'Commit and push' : 'Cancel'))
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
    await ui.input({ key: 'message', text: 'Fix it', kind: 'change' })
    await ui.press({ key: 'primary' })
    expect(world.asked[0]).toContain('committing 1 changed file first')
    expect(world.asked[0]).toContain('Files:\n- hooks/a.ts')
    expect(world.asked[0]).toContain('Commit message:\nFix it')
    const askedAt = world.ran.findIndex(argv => argv[0] === 'ask')
    const firstWriteAt = world.ran.findIndex(argv => ['add', 'commit', 'push'].includes(argv[1] ?? ''))
    expect(askedAt).toBeGreaterThan(-1)
    expect(askedAt).toBeLessThan(firstWriteAt)
    const commit = world.ran.find(argv => argv[1] === 'commit')
    expect(commit?.[3]).toBe('Fix it\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
    expect(pushes(world)).toEqual([['git', 'push', '-u', '--', 'origin', 'main']])
    expect(world.fsmonitorOff.length).toBeGreaterThan(5)
    expect(world.fsmonitorOff.every(Boolean)).toBe(true)
    expect(world.ran.some(argv => isForcePush(argv))).toBe(false)
  })

  test('lists each file inside an untracked folder, and flags a secret among them', async ($, on) => {
    // What `status --porcelain -uall` prints for a new folder; without -uall git says "?? config/".
    const world = newWorld('?? config/.env\n?? config/app.json\n', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.input({ key: 'message', text: 'Add config', kind: 'change' })
    await ui.press({ key: 'primary' })
    expect(world.ran).toContainEqual(['git', 'status', '--porcelain', '-uall'])
    expect(world.asked[0]).toContain('Files:\n- config/.env\n- config/app.json')
    expect(world.asked[0]).toContain('⚠ These look like secrets: config/.env.')
    expect(pushes(world)).toHaveLength(0)
  })

  test('an invalid new branch name is refused before anything runs', async ($, on) => {
    const world = newWorld('', () => 'Push')
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.select({ key: 'branch', value: '__new__' })
    await ui.input({ key: 'branch-name', text: 'bad..name' })
    expect(await ui.find({ type: 'Text', text: 'bad..name is not a valid branch name.' })).toBeDefined()
    expect(await ui.find({ key: 'primary' })).toBeUndefined()
    expect(world.asked).toHaveLength(0)
    expect(pushes(world)).toHaveLength(0)
  })

  test('a failed commit is undone and nothing is pushed', async ($, on) => {
    const world = newWorld(' M hooks/a.ts\n', () => 'Commit and push')
    const clock = engine(on, world, argv => (argv[1] === 'commit' ? fail('commit hook said no') : undefined))
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    await ui.input({ key: 'message', text: 'Fix it', kind: 'change' })
    await ui.press({ key: 'primary' })
    expect(world.ran.some(argv => argv.join(' ') === 'git reset -q')).toBe(true)
    expect(pushes(world)).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /commit hook said no/ })).toBeDefined()
  })
})

describe('ledger draft', () => {
  test('the commit message is prefilled from the ledger, straight from its own function', async ($, on) => {
    const world = newWorld(' M hooks/a.ts\n', () => 'Cancel')
    const clock = engine(on, world)
    const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    on('session.root', () => ({ value: ROOT }))
    on('session.messages', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.write', () => ({ value: undefined }))
    on('model.complete', (_$, e) => ({
      value: { isAnswered: true as const, text: e.prompt.startsWith('Ledger entries') ? 'Cap the API backoff\n\nReconnects flooded the proxy.' : 'Capped it.', usage },
    }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }))
    await $.command.run({ command: 'gate', args: 'approve' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${ROOT}/hooks/a.ts`, old_string: 'a', new_string: 'b' })
    await clock.settle()

    await openPanel($, clock)
    await clock.settle()
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('Cap the API backoff\n\nReconnects flooded the proxy.')
  })

  test('with no ledger entries the field stays empty and says why', async ($, on) => {
    const world = newWorld(' M hooks/a.ts\n', () => 'Cancel')
    const clock = engine(on, world)
    await openPanel($, clock)
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('')
    expect(await ui.find({ type: 'Text', text: 'Could not draft from the ledger: No ledger entries in this session yet.' })).toBeDefined()
  })
})
