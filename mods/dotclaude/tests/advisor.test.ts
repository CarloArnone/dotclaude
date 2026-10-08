import { describe, expect, test } from 'claude-code/testing'

import {
  candidates,
  catalogName,
  catalogUrl,
  githubRepoOf,
  initialOf,
  isValidRepo,
  installCommand,
  installedKeys,
  parseCatalog,
  parsePicks,
  tileColor,
} from '../hooks/features/radar/advisor'
import { AGENTS_LAYOUT_CATALOG, OFFICIAL_CATALOG, PICKS_REPLY, WELL_KNOWN_CATALOG } from './advisor-fixtures'

const official = parseCatalog(OFFICIAL_CATALOG, 'official', 'editor/plugins', true)
const wellKnown = parseCatalog(WELL_KNOWN_CATALOG, 'agent-skills', 'skills/catalog', false)

describe('catalogs', () => {
  test('lists every named plugin with its author, falling back to the catalog owner', () => {
    expect(official.map(entry => `${entry.name}|${entry.author}`)).toEqual([
      'api-security|Shield Co',
      'release-helper|Editor Team',
      'tdd-coach|Pat Doe',
    ])
    expect(official[1]).toMatchObject({ marketplace: 'official', repo: 'editor/plugins', isAdded: true })
  })

  test('reads the .agents layout, which has no descriptions', () => {
    expect(parseCatalog(AGENTS_LAYOUT_CATALOG, 'toolkit', null, true)).toEqual([
      { name: 'toolkit', marketplace: 'toolkit', author: '', description: '', repo: null, isAdded: true },
    ])
  })

  test('a catalog that does not parse lists nothing', () => {
    expect(parseCatalog('not json', 'x', null, true)).toEqual([])
    expect(parseCatalog('{"plugins": "none"}', 'x', null, true)).toEqual([])
    expect(catalogName('{')).toBeNull()
    expect(catalogName(WELL_KNOWN_CATALOG)).toBe('agent-skills')
  })

  test('GitHub sources and raw URLs', () => {
    expect(githubRepoOf({ source: 'github', repo: 'owner/repo' })).toBe('owner/repo')
    expect(githubRepoOf({ source: 'git', url: 'https://github.com/owner/repo.git' })).toBe('owner/repo')
    expect(githubRepoOf({ source: 'directory', path: '/x' })).toBeNull()
    expect(catalogUrl('owner/repo')).toBe('https://raw.githubusercontent.com/owner/repo/HEAD/.claude-plugin/marketplace.json')
  })
})

describe('what is suggested', () => {
  test('installed, enabled and hidden plugins are left out, each plugin once', () => {
    const installed = installedKeys(JSON.stringify({ version: 2, plugins: { 'tdd-coach@official': [{}] } }), { 'api-security@official': true })
    const pool = candidates([...official, ...official, ...wellKnown], installed, ['document-skills@agent-skills'])
    expect(pool.map(entry => entry.name)).toEqual(['release-helper'])
  })

  test('a plugin installed from another marketplace is not suggested again', () => {
    const pool = candidates(official, installedKeys('', { 'release-helper@elsewhere': true }), [])
    expect(pool.map(entry => entry.name)).toEqual(['api-security', 'tdd-coach'])
  })

  test('picks the catalog does not list are dropped, repeats kept once', () => {
    const picks = parsePicks(PICKS_REPLY, [...official, ...wellKnown])
    expect(picks.map(pick => `${pick.name}@${pick.marketplace}`)).toEqual(['release-helper@official', 'document-skills@agent-skills'])
    expect(picks[0]?.why).toBe('You wrote release notes by hand twice this week.')
    expect(parsePicks('No JSON here.', official)).toEqual([])
  })
})

describe('cards', () => {
  test('the install command adds the marketplace first when it is not added yet', () => {
    const [releaseHelper, documentSkills] = parsePicks(PICKS_REPLY, [...official, ...wellKnown])
    expect(installCommand(releaseHelper!)).toBe('/plugin install release-helper@official')
    expect(installCommand(documentSkills!)).toBe('/plugin marketplace add skills/catalog\n/plugin install document-skills@agent-skills')
  })

  test('the tile colour is the same for a name every time', () => {
    expect(tileColor('release-helper')).toBe(tileColor('release-helper'))
    expect(initialOf('42-tools')).toBe('4')
    expect(initialOf('release-helper')).toBe('R')
  })
})

describe('validation', () => {
  test('plugins and marketplaces with unsafe names are dropped', () => {
    const catalog = JSON.stringify({
      plugins: [{ name: 'good-one' }, { name: '../escape' }, { name: 'x; rm -rf ~' }, { name: '-flag' }, { name: 'ok.v2_x' }],
    })
    expect(parseCatalog(catalog, 'market', null, true).map(entry => entry.name)).toEqual(['good-one', 'ok.v2_x'])
    expect(parseCatalog(catalog, '../market', null, true)).toEqual([])
    expect(catalogName('{"name": "bad name"}')).toBeNull()
  })

  test('a repo must be owner/name, with no ..', () => {
    expect(isValidRepo('owner/repo.js')).toBe(true)
    expect(isValidRepo('owner/../etc')).toBe(false)
    expect(isValidRepo('owner/repo/extra')).toBe(false)
    expect(isValidRepo('own er/repo')).toBe(false)
    expect(githubRepoOf({ source: 'github', repo: 'owner/..' })).toBeNull()
    expect(githubRepoOf({ source: 'git', url: 'https://github.com/owner/repo.git' })).toBe('owner/repo')
    expect(() => catalogUrl('owner/../x')).toThrow('Not a GitHub repository')
    expect(parseCatalog(OFFICIAL_CATALOG, 'official', 'bad/../repo', true)[0]?.repo).toBeNull()
  })
})
