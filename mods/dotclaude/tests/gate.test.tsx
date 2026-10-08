import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { answerUi, PLAIN_SURFACES, SURFACES, WORKSPACE } from './host'

const CWD = '/Users/user/project'
const DENY =
  'Edit blocked: the session is still brainstorming. Start your message with "approved", "go ahead", "proceed", "lgtm", ' +
  '"ship it", "let\'s do it", "sounds good" or "GO", or press Approve.'
// Links inside the project: a plan file and a whole folder that point out of it, and a plan
// that points at another plan.
const LINKS: Record<string, string> = {
  [`${CWD}/docs/plans/escape.md`]: '/tmp/outside/docs/plans/escape.md',
  [`${CWD}/shared`]: '/tmp/elsewhere',
  [`${CWD}/docs/plans/alias.md`]: `${CWD}/docs/plans/real.md`,
}
// A link whose target does not exist yet: writing through it would create that target.
const DANGLING = `${CWD}/docs/plans/dangling.md`

/** Every path under the project exists, as itself unless a link above redirects it. */
function realPath(path: string, root: string): string | undefined {
  for (const [link, target] of Object.entries(LINKS)) {
    if (path === link || path.startsWith(`${link}/`)) return target + path.slice(link.length)
  }
  return path === root || path.startsWith(`${root}/`) ? path : undefined
}

function stubEngine(on: On, root = CWD) {
  const ui = answerUi(on)
  mock.env(on, { HOME: '/Users/user' })
  mock.clock(on, { now: 1000 })
  on('session.cwd', () => ({ value: root }))
  on('session.root', () => ({ value: root }))
  on('fs.stat', (_$, e) => {
    if (e.path === DANGLING) return { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: true } }
    const real = realPath(e.path, root)
    return real === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: real !== e.path, realPath: real } }
  })
  on('tool.call', () => ({ result: 'edited' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  return ui
}

function say($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

function edit($: Engine, filePath: string) {
  return $.tool.call({
    tool: 'Edit',
    tool_use_id: `edit-${filePath}`,
    file_path: filePath,
    old_string: 'a',
    new_string: 'b',
  })
}

function gate($: Engine, args: string) {
  return $.command.run({
    command: 'gate',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

describe('edit guard', () => {
  test('denies Edit while brainstorming', async ($, on) => {
    stubEngine(on)
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })

  test('allows Edit after a prompt that starts with "go ahead"', async ($, on) => {
    const ui = stubEngine(on)
    const submitted = await say($, 'Go ahead, thanks')

    expect(submitted.text).toBe('Go ahead, thanks')
    expect(ui.toasts).toEqual(['Approved, edits unlocked'])
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
  })

  test('needs approval words as whole words', async ($, on) => {
    stubEngine(on)
    await say($, 'the proceeds are disapproved, GOOD')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })

  test('only the person approves: a plugin prompt does not', async ($, on) => {
    stubEngine(on)
    await $.prompt.submit({ text: 'approved', wait: false, origin: { kind: 'plugin', name: 'other' } })
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })

  test('allows plan and spec paths while brainstorming', async ($, on) => {
    stubEngine(on)
    expect(await edit($, 'docs/plans/api-backoff.md')).toMatchObject({ result: 'edited' })
    expect(await edit($, `${CWD}/notes/link.spec.md`)).toMatchObject({ result: 'edited' })
    expect(await edit($, `${CWD}/mockups/index.html`)).toMatchObject({ result: 'edited' })
  })

  test('resolves dot segments before matching the allow-list', async ($, on) => {
    stubEngine(on)
    expect(await edit($, 'docs/plans/../../src/link.swift')).toEqual({ deny: DENY })
  })

  test('a plan path outside the project, or reached through a link that leaves it, stays locked', async ($, on) => {
    stubEngine(on)
    expect(await edit($, '/tmp/docs/plans/x.md')).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/docs/plans/escape.md`)).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/shared/notes.spec.md`)).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/docs/plans/new-plan.md`)).toMatchObject({ result: 'edited' })
  })

  test('a plan target that is itself a link stays locked, a dangling one too', async ($, on) => {
    stubEngine(on)
    expect(await edit($, `${CWD}/docs/plans/alias.md`)).toEqual({ deny: DENY })
    expect(await edit($, DANGLING)).toEqual({ deny: DENY })
  })

  test('only Markdown counts in plan folders; mockups also take pages and pictures', async ($, on) => {
    stubEngine(on)
    expect(await edit($, `${CWD}/docs/plans/run.sh`)).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/specs/fixture.ts`)).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/.claude/plans/hook.json`)).toEqual({ deny: DENY })
    expect(await edit($, `${CWD}/packages/api/docs/specs/limits.md`)).toMatchObject({ result: 'edited' })
    expect(await edit($, `${CWD}/mockups/flow.svg`)).toMatchObject({ result: 'edited' })
    expect(await edit($, `${CWD}/mockups/app.js`)).toEqual({ deny: DENY })
  })

  test('folders above the project root never count as plan folders', async ($, on) => {
    const root = '/Users/user/specs/project'
    stubEngine(on, root)
    expect(await edit($, `${root}/README.md`)).toEqual({ deny: DENY })
    expect(await edit($, `${root}/src/notes.md`)).toEqual({ deny: DENY })
    expect(await edit($, `${root}/specs/limits.md`)).toMatchObject({ result: 'edited' })
  })

  test('"back to brainstorm" locks edits again', async ($, on) => {
    const ui = stubEngine(on)
    await say($, 'approved')
    const submitted = await say($, 'Hold on, back to brainstorm')

    expect(submitted.text).toBe('Hold on, back to brainstorm')
    expect(ui.toasts).toEqual(['Approved, edits unlocked', 'Back to brainstorm, edits locked'])
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })

  test('/gate approve and /gate lock change the phase', async ($, on) => {
    stubEngine(on)
    await gate($, 'approve')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
    await gate($, 'lock')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })
})

describe('configured words', () => {
  test('GO unlocks only in capitals', async ($, on) => {
    stubEngine(on)
    await say($, 'ok go on')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
    await say($, 'GO')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
  })

  test('a question or a hyphenated word does not unlock, nor "GO away"', async ($, on) => {
    stubEngine(on)
    for (const text of ['approved?', 'approved-ish, not yet', 'GO away', 'GO?']) {
      await say($, text)
      expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
    }
    await say($, 'GO, do it')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
  })

  test('an approval counts only at the start of the prompt', async ($, on) => {
    stubEngine(on)
    await say($, 'is it approved?')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
    await say($, 'I think we should proceed')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
    await say($, '  approved.')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
  })

  test('a custom word unlocks when it opens the prompt', { options: { approvalWords: 'yes, GO' } }, async ($, on) => {
    stubEngine(on)
    await say($, 'yes, do it')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
  })

  test('a default lock phrase locks again', async ($, on) => {
    stubEngine(on)
    await say($, 'approved')
    await say($, 'wait, one more thing')
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({ deny: DENY })
  })

  test('custom approval words unlock, and the refusal names them', { options: { approvalWords: 'make it so, ok go', lockPhrases: 'hold on' } }, async ($, on) => {
    stubEngine(on)
    expect(await edit($, `${CWD}/src/link.swift`)).toEqual({
      deny: 'Edit blocked: the session is still brainstorming. Start your message with "make it so" or "ok go", or press Approve.',
    })
    await say($, 'approved')
    expect((await edit($, `${CWD}/src/link.swift`)).deny).toBeDefined()
    await say($, 'Make it so, thanks')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
    await say($, 'stop')
    expect(await edit($, `${CWD}/src/link.swift`)).toMatchObject({ result: 'edited' })
    await say($, 'hold on')
    expect((await edit($, `${CWD}/src/link.swift`)).deny).toBeDefined()
  })
})

describe('gate panel', () => {
  test('/gate opens it beside the vitals; it toggles on terminal and desktop', async ($, on) => {
    stubEngine(on)
    await gate($, '')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: /Brainstorming, edits locked/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Phase follows your words/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Edits locked' })).toBeDefined()

      await ui.press({ key: 'approve' })
      expect(await ui.find({ type: 'Text', text: /Approved, edits open/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Edits open' })).toBeDefined()
      expect((await ui.find({ key: 'relock' }))?.props.label).toBe('↺ Back to brainstorm')

      await ui.press({ key: 'relock' })
      expect((await ui.find({ key: 'approve' }))?.props.variant).toBe('primary')
      await ui.unmount()
    }
  })

  test('falls back to plain text on vscode and mobile', async ($, on) => {
    stubEngine(on)
    await gate($, '')
    for (const surface of PLAIN_SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: /Brainstorming, edits locked/ })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
  })
})
