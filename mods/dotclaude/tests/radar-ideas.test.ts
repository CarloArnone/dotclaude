import { expect, test } from 'claude-code/testing'

import { draftPrompt, extractSession, filterIdeas, parseIdeas } from '../hooks/features/radar/logic'
import { MODEL_REPLY, TRANSCRIPT } from './radar-fixtures'

test('keeps only the person\'s own prompts from a transcript', () => {
  const digest = extractSession(TRANSCRIPT, '-Users-user-fallback')
  expect(digest.prompts).toEqual(['Write release notes for version 2.3', 'Now a changelog entry'])
  expect(digest.date).toBe('2026-10-03')
  expect(digest.project).toBe('demo-app')
})

test('a transcript with no human prompt yields none', () => {
  const digest = extractSession('{"type":"user","message":{"content":"<command-name>/x</command-name>"}}', 'p')
  expect(digest.prompts).toEqual([])
  expect(digest.project).toBe('p')
})

test('parses JSON wrapped in prose and fences, ids slugged, capped per kind', () => {
  const ideas = parseIdeas(MODEL_REPLY)
  expect(ideas?.map(idea => `${idea.kind}:${idea.id}`)).toEqual([
    'skill:release-notes',
    'skill:plan-gate',
    'skill:old-idea',
    'mod:quick-deploy',
    'agent:build-log-reader',
  ])
})

test('an unreadable reply parses to undefined, a bad item is skipped', () => {
  expect(parseIdeas('Sorry, nothing to suggest.')).toBeUndefined()
  expect(parseIdeas('{ "skills": [ broken')).toBeUndefined()
  expect(parseIdeas('{"skills":[{"id":"no-title"},"x"],"mods":"none"}')).toEqual([])
})

test('drops ideas that exist, were dismissed, or are saved for later', () => {
  const ideas = parseIdeas(MODEL_REPLY) ?? []
  const kept = filterIdeas(ideas, ['example:plan-gate', 'caveman'], ['old-idea', 'quick-deploy'])
  expect(kept.map(idea => idea.id)).toEqual(['release-notes', 'build-log-reader'])
})

test('the draft prompt asks for a gated brainstorm and names where to save', () => {
  const text = draftPrompt({ id: 'a', kind: 'agent', title: 'Log reader', evidence: 'E', pitch: 'P' })
  expect(text).toContain('Brainstorm this agent with me first')
  expect(text).toContain('ask me where to create it')
  expect(text).toContain('Do not push.')
})
