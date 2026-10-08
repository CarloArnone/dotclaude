import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { AGENTS_LAYOUT_CATALOG, OFFICIAL_CATALOG, PICKS_REPLY, SINGLE_CATALOG, WELL_KNOWN_CATALOG } from './advisor-fixtures'
import { answerUi, paneProps, SURFACES, WORKSPACE } from './host'

const HOME = '/home/user'
const CLAUDE = `${HOME}/.claude`
const MARKETS = `${CLAUDE}/plugins/marketplaces`
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type World = { store: Map<string, unknown>; copied: string[]; toasts: string[]; prompts: string[]; fetched: string[] }

// A machine with three marketplaces (one on GitHub, one local, one only as a folder), one
// plugin installed and one enabled; GitHub answers the raw catalogs unless offline.
function world(on: On, isOnline = true): World {
  const ui = answerUi(on)
  const state: World = { store: new Map(), copied: [], toasts: ui.toasts, prompts: [], fetched: [] }
  const files: Record<string, string> = {
    [`${CLAUDE}/plugins/known_marketplaces.json`]: JSON.stringify({
      official: { source: { source: 'github', repo: 'editor/plugins' }, installLocation: `${MARKETS}/official` },
      terse: { source: { source: 'directory', path: '/srv/terse' }, installLocation: `${MARKETS}/terse` },
    }),
    [`${MARKETS}/official/.claude-plugin/marketplace.json`]: OFFICIAL_CATALOG,
    [`${MARKETS}/terse/.claude-plugin/marketplace.json`]: SINGLE_CATALOG,
    [`${MARKETS}/toolkit/.agents/plugins/marketplace.json`]: AGENTS_LAYOUT_CATALOG,
    [`${CLAUDE}/plugins/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: { 'tdd-coach@official': [{ scope: 'user' }] } }),
    [`${CLAUDE}/settings.json`]: JSON.stringify({ enabledPlugins: { 'terse@terse': true } }),
  }
  const remote: Record<string, string> = {
    'https://raw.githubusercontent.com/editor/plugins/HEAD/.claude-plugin/marketplace.json': OFFICIAL_CATALOG,
    'https://raw.githubusercontent.com/anthropics/skills/HEAD/.claude-plugin/marketplace.json': WELL_KNOWN_CATALOG,
  }
  mock.env(on, { HOME })
  mock.clock(on, { now: Date.UTC(2026, 9, 8) })
  on('fs.exists', (_$, e) => ({ value: e.path in files || e.path === MARKETS }))
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: `ENOENT ${e.path}` }))
  on('fs.list', (_$, e) => ({
    value: e.path === MARKETS ? ['official', 'terse', 'toolkit'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) : [],
  }))
  on('http.fetch', (_$, e) => {
    state.fetched.push(e.url)
    if (!isOnline) throw new Error('network is unreachable')
    const text = remote[e.url]
    return { value: { ok: text !== undefined, status: text === undefined ? 404 : 200, text: text ?? 'Not Found', headers: {} } } as never
  })
  on('model.complete', (_$, e) => {
    state.prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: PICKS_REPLY, usage: USAGE } }
  })
  on('store.get', (_$, e) => ({ value: state.store.get(e.key) }))
  on('store.set', (_$, e) => {
    state.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    state.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return state
}

async function openAdvisor($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.command.run({ command: 'radar', args: '' })
  const ui = await $.ui.mount({ ...WORKSPACE, surface })
  await ui.press({ key: 'radar-tabs-advisor' })
  return ui
}

describe('advisor', () => {
  test('a scan suggests only catalog plugins that are not installed, from GitHub and the well-known list', async ($, on) => {
    const state = world(on)
    const ui = await openAdvisor($)
    expect(await ui.find({ type: 'Text', text: /Reads the plugin catalogs/ })).toBeDefined()
    expect(state.prompts).toHaveLength(0)

    await ui.press({ key: 'advisor-scan' })
    expect(state.prompts[0]).toContain('- release-helper@official by Editor Team: Draft release notes')
    expect(state.prompts[0]).toContain('document-skills@agent-skills')
    expect(state.prompts[0]).not.toContain('tdd-coach@official by')
    expect(state.prompts[0]).not.toContain('terse@terse by')
    expect(await ui.find({ type: 'Text', text: 'release-helper' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Why: You wrote release notes by hand twice this week.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'document-skills' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'made-up-plugin' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /GitHub could not be reached/ })).toBeUndefined()
    expect((state.store.get('advisorLast') as { picks: unknown[] }).picks).toHaveLength(2)
  })

  test('offline, it falls back to the catalogs on this machine and says so', async ($, on) => {
    world(on, false)
    const ui = await openAdvisor($)
    await ui.press({ key: 'advisor-scan' })
    expect(await ui.find({ type: 'Text', text: 'GitHub could not be reached, so the suggestions come from the catalogs on this Mac.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'release-helper' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'document-skills' })).toBeUndefined()
  })

  test('Copy install copies the marketplace and install lines for the surface pressed', async ($, on) => {
    const state = world(on)
    const ui = await openAdvisor($)
    await ui.press({ key: 'advisor-scan' })
    await ui.press({ key: 'copy-document-skills@agent-skills' })
    expect(state.copied).toEqual(['/plugin marketplace add anthropics/skills\n/plugin install document-skills@agent-skills'])
    await ui.press({ key: 'copy-release-helper@official' })
    expect(state.copied[1]).toBe('/plugin install release-helper@official')
    expect(state.toasts).toContain('Install command copied')
  })

  test('Hide drops a plugin and keeps it out of later scans', async ($, on) => {
    const state = world(on)
    const ui = await openAdvisor($)
    await ui.press({ key: 'advisor-scan' })
    await ui.press({ key: 'hide-release-helper@official' })
    expect(await ui.find({ type: 'Text', text: 'release-helper' })).toBeUndefined()
    expect(state.store.get('advisorHidden')).toEqual(['release-helper@official'])
    await ui.press({ key: 'advisor-scan' })
    expect(state.prompts[1]).not.toContain('release-helper@official by')
  })

  test('cards draw on the terminal and the desktop, with the initial tile', async ($, on) => {
    world(on)
    const first = await openAdvisor($)
    await first.press({ key: 'advisor-scan' })
    await first.unmount()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, surface })
      expect(await ui.find({ type: 'Text', text: 'release-helper' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Editor Team' })).toBeDefined()
      if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === 'release-helper')).toBe(true)
      else expect(await ui.find({ type: 'Text', text: ' R ' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the last results come back from the store when Radar opens', async ($, on) => {
    const state = world(on)
    state.store.set('advisorLast', {
      scannedAt: Date.UTC(2026, 9, 1),
      catalogCount: 3,
      note: null,
      picks: [{ name: 'tdd-coach', marketplace: 'official', author: 'Pat Doe', description: 'Tests first.', why: 'Earlier scan.', repo: 'editor/plugins', isAdded: true }],
    })
    const ui = await openAdvisor($)
    expect(await ui.find({ type: 'Text', text: 'From 3 catalogs, scanned 2026-10-01.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Why: Earlier scan.' })).toBeDefined()
  })
})

describe('layout', () => {
  test("a card's long text wraps inside the side column, which clips at its width share", async ($, on) => {
    const state = world(on)
    const long = 'Drafts release notes and changelog entries from merged commits, grouped by area. '.repeat(6)
    state.store.set('advisorLast', {
      scannedAt: Date.UTC(2026, 9, 1),
      catalogCount: 1,
      note: null,
      picks: [{ name: 'release-helper', marketplace: 'official', author: 'Editor Team', description: long, why: long, repo: 'editor/plugins', isAdded: true }],
    })
    await $.command.run({ command: 'radar', args: '' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...WORKSPACE, props: paneProps(80, 40), surface })
      await ui.press({ key: 'radar-tabs-advisor' })
      const side = await ui.find({ type: 'Box', key: 'side-column' })
      expect(side?.props).toMatchObject({ width: 39, minWidth: 0, flexShrink: 1, overflow: 'hidden' })
      expect((await ui.find({ type: 'Box', key: 'main-column' }))?.props).toMatchObject({ minWidth: 0, overflow: 'hidden' })
      expect((await ui.find({ type: 'Box', key: 'panel-radar' }))?.props).toMatchObject({ width: 39, overflow: 'hidden' })
      expect((await ui.find({ type: 'Box', key: 'pick-release-helper@official-text' }))?.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
      const description = await ui.find({ type: 'Text', text: /^Drafts release notes/ })
      expect(description?.props.wrap).toBe('wrap')
      expect(description?.text.length).toBeLessThanOrEqual(140)
      expect(description?.text.endsWith('…')).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^Why: Drafts/ }))?.props.wrap).toBe('wrap')
      await ui.unmount()
    }
  })
})

describe('tabs', () => {
  test('Ideas and Advisor switch at once; the shown tab is the primary one; keys stay put', async ($, on) => {
    const state = world(on)
    await $.command.run({ command: 'radar', args: '' })
    const ui = await $.ui.mount({ ...WORKSPACE, surface: 'terminal' })
    expect((await ui.find({ key: 'radar-tabs-ideas' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'radar-tabs-advisor' }))?.props.variant).toBeUndefined()
    expect(await ui.find({ key: 'scan' })).toBeDefined()

    await ui.press({ key: 'radar-tabs-advisor' })
    expect((await ui.find({ key: 'radar-tabs-advisor' }))?.props.variant).toBe('primary')
    expect(await ui.find({ key: 'advisor-scan' })).toBeDefined()
    expect(await ui.find({ key: 'scan' })).toBeUndefined()

    const keys = (await ui.findAll({ type: 'Button' })).map(button => button.key)
    await ui.press({ key: 'radar-tabs-advisor' })
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(keys)
    await ui.press({ key: 'radar-tabs-ideas' })
    expect(await ui.find({ key: 'scan' })).toBeDefined()
    expect(state.toasts).toEqual([])
  })
})
