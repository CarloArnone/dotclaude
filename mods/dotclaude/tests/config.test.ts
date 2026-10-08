import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, expandHome, mentionsAny, readConfig, startsWithAny } from '../hooks/config'

describe('options', () => {
  test('unset options take their defaults', () => {
    expect(readConfig({})).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.vaultPath).toBe('~/Notes')
    expect(DEFAULT_CONFIG.companionPort).toBe(4747)
    expect(DEFAULT_CONFIG.conventionsSkill).toBe('notes-conventions')
    expect(readConfig({ conventionsSkill: ' team-notes ' }).conventionsSkill).toBe('team-notes')
  })

  test('comma-separated words are trimmed, and blanks dropped', () => {
    const config = readConfig({ approvalWords: ' approved ,make it so,, ok go ', lockPhrases: 'hold on' })
    expect(config.approvalWords).toEqual(['approved', 'make it so', 'ok go'])
    expect(config.lockPhrases).toEqual(['hold on'])
  })

  test('blank or malformed values fall back to the default', () => {
    const config = readConfig({ vaultPath: '  ', approvalWords: ' , ', companionPort: 70_000 })
    expect(config.vaultPath).toBe('~/Notes')
    expect(config.approvalWords).toEqual(DEFAULT_CONFIG.approvalWords)
    expect(config.companionPort).toBe(4747)
    expect(readConfig({ companionPort: 8123 }).companionPort).toBe(8123)
  })

  test('~ expands to the home folder; other paths stay as written', () => {
    expect(expandHome('~/Notes', '/home/user')).toBe('/home/user/Notes')
    expect(expandHome('~', '/home/user')).toBe('/home/user')
    expect(expandHome('/srv/vault', '/home/user')).toBe('/srv/vault')
    expect(expandHome('notes~/x', '/home/user')).toBe('notes~/x')
  })
})

describe('phrase matching', () => {
  test('whole words only, any case', () => {
    expect(mentionsAny('Looks good, Approved!', ['approved'])).toBe(true)
    expect(mentionsAny('disapproved', ['approved'])).toBe(false)
    expect(mentionsAny('the proceeds', ['proceed'])).toBe(false)
  })

  test('a phrase matches across any spacing', () => {
    expect(mentionsAny('ok, go   ahead', ['go ahead'])).toBe(true)
    expect(mentionsAny("Let's do it.", ["let's do it"])).toBe(true)
  })

  test('GO matches only in capitals, as a word of its own', () => {
    expect(mentionsAny('GO', ['GO'])).toBe(true)
    expect(mentionsAny('Fine. GO!', ['GO'])).toBe(true)
    expect(mentionsAny('go', ['GO'])).toBe(false)
    expect(mentionsAny('Go on then', ['GO'])).toBe(false)
    expect(mentionsAny('GOOD', ['GO'])).toBe(false)
  })
})

describe('approval at the start', () => {
  test('counts only when the prompt opens with it', () => {
    const words = ['approved', 'go ahead', 'yes', 'GO']
    expect(startsWithAny('approved', words)).toBe(true)
    expect(startsWithAny('  Approved. Ship it', words)).toBe(true)
    expect(startsWithAny('yes, do it', words)).toBe(true)
    expect(startsWithAny('Go ahead!', words)).toBe(true)
    expect(startsWithAny('GO', words)).toBe(true)
    expect(startsWithAny('is it approved?', words)).toBe(false)
    expect(startsWithAny('approvedish', words)).toBe(false)
    expect(startsWithAny('go on', words)).toBe(false)
    expect(startsWithAny('GOOD', words)).toBe(false)
  })

  test('only an end, a space or . , ! : may follow the word', () => {
    const words = ['approved', 'go ahead', 'GO']
    expect(startsWithAny('approved: go', words)).toBe(true)
    expect(startsWithAny('approved, thanks', words)).toBe(true)
    expect(startsWithAny('approved?', words)).toBe(false)
    expect(startsWithAny('approved? not yet', words)).toBe(false)
    expect(startsWithAny('approved-ish', words)).toBe(false)
    expect(startsWithAny('go ahead?', words)).toBe(false)
  })

  test('a word in capitals unlocks alone or before . , ! : only', () => {
    const words = ['GO']
    expect(startsWithAny('GO', words)).toBe(true)
    expect(startsWithAny('GO, do it', words)).toBe(true)
    expect(startsWithAny('GO!', words)).toBe(true)
    expect(startsWithAny('GO away', words)).toBe(false)
    expect(startsWithAny('GO?', words)).toBe(false)
    expect(startsWithAny('GO-live is friday', words)).toBe(false)
  })
})
