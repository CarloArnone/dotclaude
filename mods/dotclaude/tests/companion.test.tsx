import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerUi, SURFACES, WORKSPACE } from './host'

const HOME = '/home/user'
const DIR = `${HOME}/.claude/companion`
const PLUGIN_ROOT_SHELL = /\/assets\/index\.html$/
const TOKEN_FILE = `${HOME}/.claude/companion.token`
const SAVED_TOKEN = '0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b'

type World = {
  files: Map<string, string>
  spawned: string[][]
  toasts: string[]
  previews: unknown[]
  clock: ReturnType<typeof mock.clock>
  /** What a server already on the port answers at /__token; undefined while the port is free. */
  portAnswer: string | undefined
  /** The HTTP status that server answers /__token with: 200 for a companion. */
  portStatus: number
  /** Whether that server stops when asked with the right token. */
  stopsWhenAsked: boolean
  /** The tokens sent to /__shutdown. */
  shutdowns: string[]
  /** The paths written through the shell under umask 077. */
  privateWrites: string[]
  /** Paths a stat reports as symbolic links. */
  links: string[]
}

// The host beneath the plugin, in memory: files, a server child that stays up until its
// stream is ended, and a browser pane server that is there or not.
function world(on: On, hasBrowserPane = false, env: Record<string, string> = {}): World {
  const ui = answerUi(on)
  const files = new Map<string, string>()
  const spawned: string[][] = []
  const previews: unknown[] = []
  mock.env(on, { HOME, ...env })
  const clock = mock.clock(on, { now: 1_000 })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || PLUGIN_ROOT_SHELL.test(e.path) }))
  on('fs.read', ($, e) => {
    if (PLUGIN_ROOT_SHELL.test(e.path)) return { value: '<meta name="generator" content="companion-shell">' }
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  // The project the session works in; `/companion show` takes files from it only.
  on('session.root', () => ({ value: '/notes' }))
  on('fs.stat', ($, e) => {
    if (state.links.includes(e.path)) return { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: true } }
    const text = files.get(e.path)
    if (text !== undefined) return { value: { kind: 'file' as const, size: text.length, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT ${e.path}` }
  })
  on('http.fetch', (_$, e) => {
    if (state.portAnswer === undefined) throw new Error('connection refused')
    if (e.url.endsWith('/__shutdown')) {
      const token = String((e.init?.headers as Record<string, string> | undefined)?.['X-Companion-Token'])
      state.shutdowns.push(token)
      const stops = state.stopsWhenAsked && e.init?.method === 'POST' && token === state.portAnswer
      if (stops) state.portAnswer = undefined
      return { value: { ok: stops, status: stops ? 200 : 403, text: '', headers: {} } } as never
    }
    if (!e.url.endsWith('/__token')) throw new Error('connection refused')
    const ok = state.portStatus === 200
    return { value: { ok, status: state.portStatus, text: state.portAnswer, headers: {} } } as never
  })
  // The token file is written by `sh` under umask 077; the script's last two arguments are text and path.
  on('process.run', ($, e) => {
    const [command, flag, script, , text, path] = e.argv
    if (command !== 'sh' || flag !== '-c' || !script?.startsWith('umask 077 ') || text === undefined || path === undefined) {
      throw new Error(`unexpected command ${e.argv.join(' ')}`)
    }
    files.set(path, text)
    state.privateWrites.push(path)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e, next) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: 'Serving HTTP on 127.0.0.1 port 4747' }
    await new Promise(resolve => next.signal.addEventListener('abort', resolve))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  on('mcp.call', ($, e) => {
    if (!hasBrowserPane) throw new Error('no such server')
    previews.push(e)
    return { value: { isError: false, content: [] } } as never
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const state: World = {
    files,
    spawned,
    toasts: ui.toasts,
    previews,
    clock,
    portAnswer: undefined,
    portStatus: 200,
    stopsWhenAsked: true,
    shutdowns: [],
    privateWrites: [],
    links: [],
  }
  return state
}

function companion($: Engine, args = '') {
  return $.command.run({
    command: 'companion',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

function sectionIds($: Engine, on: On) {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hi.', scope: 'shared' as const }] }))
  return async () => {
    const { sections } = await $.prompt.compose({
      model: 'm',
      promptModel: 'm',
      surfaces: ['terminal'],
      tools: [],
      outputStyle: null,
      traits: [],
    })
    return sections.map(section => section.id)
  }
}

// Under the kit each open of the companion takes about a second (measured on the original
// mod, cause not pinned down), so the tests that open it get past the 5 s default.
const SLOW = { timeoutMs: 20_000 }

test('/companion serves on 127.0.0.1 only and opens the Companion view', SLOW, async ($, on) => {
  const { files, spawned, toasts, clock } = world(on)

  const opened = await companion($)
  expect(opened.text).toContain('http://127.0.0.1:4747')
  // The plugin's own server script, which binds 127.0.0.1 itself: port, folder, session token.
  expect(spawned[0]?.slice(0, 2)).toEqual(['python3', '-u'])
  expect(spawned[0]?.[2]).toMatch(/\/assets\/server\.py$/)
  expect(spawned[0]?.slice(3, 5)).toEqual(['4747', DIR])
  expect(spawned[0]?.[5]).toMatch(/^[0-9a-f-]{36}$/)
  expect(files.has(`${DIR}/index.html`)).toBe(true)
  expect(files.get(`${DIR}/views/manifest.json`)).toBe('[]\n')
  await clock.settle()
  // No browser pane server here, so the fallback toasts the URL.
  expect(toasts).toContain('Companion: http://127.0.0.1:4747')

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '● Companion open at http://127.0.0.1:4747' })).toBeDefined()
  // The view stands in the main column in place of the vitals, so their chip is not drawn.
  expect(await ui.find({ type: 'Text', text: /^● Companion open$/ })).toBeUndefined()
})

test('a second /companion keeps it open; Close companion stops it', SLOW, async ($, on) => {
  const { spawned } = world(on)
  await companion($)
  const again = await companion($)
  expect(again.text).toBe('Companion already open at http://127.0.0.1:4747.')
  expect(spawned).toHaveLength(1)

  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'desktop' })
  await ui.press({ key: 'stop' })
  expect(await ui.find({ type: 'Text', text: '● Companion closed' })).toBeDefined()
  expect((await ui.find({ key: 'open' }))?.props.variant).toBe('primary')
})

test('uses the desktop browser pane when its server is there', SLOW, async ($, on) => {
  const { previews, toasts } = world(on, true)
  const opened = await companion($)
  expect(opened.text).toBe('Companion open at http://127.0.0.1:4747.')
  expect(previews).toHaveLength(1)
  expect(toasts).not.toContain('Companion: http://127.0.0.1:4747')
})

test('compose adds the companion section only while open', SLOW, async ($, on) => {
  world(on)
  const ids = sectionIds($, on)

  expect(await ids()).toEqual(['intro'])
  await companion($)
  expect(await ids()).toEqual(['intro', 'companion:view'])
  const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
  await ui.press({ key: 'stop' })
  expect(await ids()).toEqual(['intro'])
})

test('show renders a .md file to a view and updates the manifest', SLOW, async ($, on) => {
  const { files } = world(on)
  files.set('/notes/plan.md', '# API backoff\n\n- retry **twice**\n- then `sleep`\n\n[docs](https://example.com)')

  const shown = await companion($, 'show /notes/plan.md')
  expect(shown.text).toContain('Showing "API backoff"')

  const view = files.get(`${DIR}/views/plan.html`) ?? ''
  expect(view).toContain('<h1>API backoff</h1>')
  expect(view).toContain('<li>retry <strong>twice</strong></li>')
  expect(view).toContain('<code>sleep</code>')
  expect(view).toContain('<a href="https://example.com"')
  expect(JSON.parse(files.get(`${DIR}/views/manifest.json`) ?? '')).toEqual([
    { slug: 'plan', title: 'API backoff', createdAt: 1_000 },
  ])
})

test('show refuses a relative path and other file types', async ($, on) => {
  world(on)
  expect((await companion($, 'show notes/plan.md')).text).toContain('absolute path')
  expect((await companion($, 'show /notes/plan.txt')).text).toContain('.html and .md')
  expect((await companion($, 'nonsense')).text).toContain('Usage')
})

test('show takes files from the project only, and no symbolic links', async ($, on) => {
  const state = world(on)
  state.files.set('/etc/page.html', '<p>outside</p>')
  state.files.set('/notes/link.html', '<p>linked</p>')
  state.links.push('/notes/link.html')
  expect((await companion($, 'show /etc/page.html')).text).toBe('Companion: only files inside this project can be shown, and no symbolic links')
  expect((await companion($, 'show /notes/link.html')).text).toBe('Companion: only files inside this project can be shown, and no symbolic links')
  expect([...state.files.keys()].some(path => path.includes('/views/page') || path.includes('/views/link'))).toBe(false)
})

test('the vitals show a Companion open chip while it is open, on terminal and desktop', SLOW, async ($, on) => {
  world(on)
  await $.command.run({ command: 'vitals', args: '' })
  for (const surface of SURFACES) {
    const closed = await $.ui.mount({ ...WORKSPACE, surface })
    expect(await closed.find({ type: 'Text', text: /^● Companion open$/ })).toBeUndefined()
    await closed.unmount()
  }
  await companion($)
  await $.command.run({ command: 'vitals', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...WORKSPACE, surface })
    expect((await ui.find({ type: 'Text', text: /^● Companion open$/ }))?.props.color).toBe('#4cc9f0')
    await ui.unmount()
  }
})

test('the companion folder follows CLAUDE_CONFIG_DIR', SLOW, async ($, on) => {
  const { files, spawned } = world(on, false, { CLAUDE_CONFIG_DIR: '/cfg' })
  await companion($)
  expect(files.has('/cfg/companion/index.html')).toBe(true)
  expect(spawned[0]).toContain('/cfg/companion')
})

test('the companionPort option moves the server and its URL', { ...SLOW, options: { companionPort: 8123 } }, async ($, on) => {
  const { spawned } = world(on)
  const opened = await companion($)
  expect(opened.text).toContain('http://127.0.0.1:8123')
  expect(spawned[0]).toContain('8123')
})

const FREE_IT = 'free it (lsof -nP -iTCP:4747 -sTCP:LISTEN names the process to quit) or set the companionPort option'

test('another program on the port is not trusted, and the message says how to free it', SLOW, async ($, on) => {
  const state = world(on)
  state.portAnswer = 'Not found'
  state.portStatus = 404
  const opened = await companion($)
  expect(opened.text).toBe(`Companion: port 4747 is used by another program; ${FREE_IT}`)
  expect(state.spawned).toHaveLength(0)
  expect(state.shutdowns).toHaveLength(0)
})

test('a companion answering another token is an older one: not trusted, nor asked to stop', SLOW, async ($, on) => {
  const state = world(on)
  state.portAnswer = 'an-older-token'
  const opened = await companion($)
  expect(opened.text).toBe(`Companion: port 4747 is held by a companion server from an earlier version or session; ${FREE_IT}`)
  expect(state.spawned).toHaveLength(0)
  expect(state.shutdowns).toHaveLength(0)
})

test('the token is saved for later sessions, readable by its owner only, outside the served folder', SLOW, async ($, on) => {
  const state = world(on)
  await companion($)
  const token = state.spawned[0]?.[5]
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  expect(state.privateWrites).toEqual([TOKEN_FILE])
  expect(state.files.get(TOKEN_FILE)).toBe(token)
  expect(TOKEN_FILE.startsWith(`${DIR}/`)).toBe(false)
})

test('a saved token is reused, and a server an earlier session left with it is replaced', SLOW, async ($, on) => {
  const state = world(on)
  state.files.set(TOKEN_FILE, `${SAVED_TOKEN}\n`)
  state.portAnswer = SAVED_TOKEN
  const opened = await companion($)
  expect(opened.text).toBe('Companion served at http://127.0.0.1:4747; asked Claude to open it in the browser pane.')
  expect(state.shutdowns).toEqual([SAVED_TOKEN])
  expect(state.spawned).toHaveLength(1)
  expect(state.spawned[0]?.[5]).toBe(SAVED_TOKEN)
  expect(state.privateWrites).toHaveLength(0)
})

test('a server with our token that will not stop is reused, not started beside it', SLOW, async ($, on) => {
  const state = world(on)
  state.files.set(TOKEN_FILE, SAVED_TOKEN)
  state.portAnswer = SAVED_TOKEN
  state.stopsWhenAsked = false
  await companion($)
  expect(state.shutdowns).toEqual([SAVED_TOKEN])
  expect(state.spawned).toHaveLength(0)
})

test('a saved file that is not a token is replaced by a new one', SLOW, async ($, on) => {
  const state = world(on)
  state.files.set(TOKEN_FILE, 'garbage')
  await companion($)
  expect(state.privateWrites).toEqual([TOKEN_FILE])
  expect(state.files.get(TOKEN_FILE)).toMatch(/^[0-9a-f-]{36}$/)
})

test('an older shell page in the companion folder is replaced by the plugin\'s', SLOW, async ($, on) => {
  const { files } = world(on)
  files.set(`${DIR}/index.html`, '<p>old shell</p>')
  await companion($)
  expect(files.get(`${DIR}/index.html`)).toBe('<meta name="generator" content="companion-shell">')
})

// ---- Files Claude hands over or writes reach the open companion ------------------

const SESSION_ID = '00000000-0000-4000-8000-000000000000'
const SCRATCH = `/private/tmp/claude-1000/-project/${SESSION_ID}/scratchpad`

/** The session's identity and the tools beneath the plugin: Write stores the file, SendUserFile succeeds. */
function outputs(on: On, files: Map<string, string>) {
  on('session.cwd', () => ({ value: '/notes' }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('tool.call', { tool: 'Write' }, ($, e) => {
    files.set(e.file_path, e.content)
    return { result: { type: 'create' } } as never
  })
  on('tool.call', { tool: 'SendUserFile' }, () => ({ result: { attachments: [] } }) as never)
}

async function openAndApprove($: Engine) {
  await companion($)
  await $.command.run({ command: 'gate', args: 'approve' })
}

function manifestSlugs(files: Map<string, string>): string[] {
  return (JSON.parse(files.get(`${DIR}/views/manifest.json`) ?? '[]') as { slug: string }[]).map(view => view.slug)
}

test('a file sent to the user is shown, relative paths against the working folder', SLOW, async ($, on) => {
  const { files } = world(on)
  outputs(on, files)
  files.set('/notes/out/chart.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
  files.set(`${SCRATCH}/report.csv`, 'name,cost\n"a, b",1.5\n')
  files.set('/notes/out/data.bin', 'x')
  await openAndApprove($)

  await $.tool.call({ tool: 'SendUserFile', files: ['out/chart.svg', `${SCRATCH}/report.csv`, '/notes/out/data.bin'], status: 'normal' })

  expect(manifestSlugs(files)).toEqual(['chart', 'report', 'data'])
  expect(files.get(`${DIR}/views/chart.html`)).toContain('<circle r="4"/>')
  expect(files.get(`${DIR}/views/report.html`)).toContain('<td>a, b</td><td>1.5</td>')
  expect(files.get(`${DIR}/views/data.html`)).toContain('/notes/out/data.bin')
})

test('a sent file outside the project and scratchpad, or too large, shows only its path', SLOW, async ($, on) => {
  const { files } = world(on)
  outputs(on, files)
  files.set('/elsewhere/keys.json', '{"token":"do-not-copy"}')
  files.set('/notes/huge.csv', 'x'.repeat(2 * 1024 * 1024 + 1))
  await openAndApprove($)

  await $.tool.call({ tool: 'SendUserFile', files: ['/elsewhere/keys.json', '/notes/huge.csv'], status: 'normal' })

  expect(manifestSlugs(files)).toEqual(['keys', 'huge'])
  expect(files.get(`${DIR}/views/keys.html`)).toContain('/elsewhere/keys.json')
  expect(files.get(`${DIR}/views/keys.html`)).not.toContain('do-not-copy')
  expect(files.get(`${DIR}/views/huge.html`)).not.toContain('xxxx')
})

test('new pages written in the project or scratchpad are shown; edits, other kinds and places are not', SLOW, async ($, on) => {
  const { files } = world(on)
  outputs(on, files)
  files.set('/notes/old.md', '# Old')
  await openAndApprove($)

  await $.tool.call({ tool: 'Write', file_path: '/notes/plan.md', content: '# Retry plan\n' })
  await $.tool.call({ tool: 'Write', file_path: `${SCRATCH}/usage.json`, content: '{"a":1}' })
  await $.tool.call({ tool: 'Write', file_path: '/notes/old.md', content: '# Rewritten' })
  await $.tool.call({ tool: 'Write', file_path: '/notes/main.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/elsewhere/page.html', content: '<p>x</p>' })
  await $.tool.call({ tool: 'Write', file_path: '/private/tmp/claude-1000/-project/other-session/scratchpad/a.html', content: '<p>x</p>' })
  await $.tool.call({ tool: 'Write', file_path: `${SCRATCH}/../../../../Users/x/escape.html`, content: '<p>x</p>' })

  expect(manifestSlugs(files)).toEqual(['plan', 'usage'])
  expect(files.get(`${DIR}/views/usage.html`)).toContain('&quot;a&quot;: 1')
})

test('nothing is shown while the companion is closed', SLOW, async ($, on) => {
  const { files } = world(on)
  outputs(on, files)
  files.set('/notes/chart.html', '<p>chart</p>')
  await $.command.run({ command: 'gate', args: 'approve' })

  await $.tool.call({ tool: 'SendUserFile', files: ['/notes/chart.html'], status: 'normal' })
  await $.tool.call({ tool: 'Write', file_path: '/notes/new.html', content: '<p>new</p>' })

  expect(files.has(`${DIR}/views/manifest.json`)).toBe(false)
})
