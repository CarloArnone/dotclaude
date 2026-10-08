import { describe, expect, test } from 'claude-code/testing'

import type { GitPanelForm, GitPanelRepo } from '../types'
import { stepArgv } from '../hooks/features/git/git'
import {
  CO_AUTHOR,
  CURRENT_REMOTE,
  NEW_BRANCH,
  NEW_REPO,
  changedPath,
  confirmationText,
  defaultRepoChoice,
  freeRemoteName,
  githubSlug,
  isForcePush,
  isSafeName,
  riskyFiles,
  planFrom,
  primaryLabel,
  withCoAuthor,
} from '../hooks/features/git/plan'
import type { Plan } from '../hooks/features/git/plan'
import { buildSteps, remoteDecision } from '../hooks/features/git/steps'

const REPO: GitPanelRepo = {
  kind: 'repo',
  root: '/work/app',
  folderName: 'app',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  files: [],
  branches: ['main', 'dev'],
  remotes: [{ name: 'origin', url: 'git@github.com:octocat/app.git' }],
  github: {
    isAvailable: true,
    repos: [
      { nameWithOwner: 'octocat/app', isPrivate: true, url: 'https://github.com/octocat/app' },
      { nameWithOwner: 'octocat/other', isPrivate: false, url: 'https://github.com/octocat/other' },
    ],
  },
}

const DIRTY: GitPanelRepo = { ...REPO, files: [' M hooks/a.ts', '?? new.txt'] }

function planOf(repo: GitPanelRepo, form: GitPanelForm): Plan {
  const planned = planFrom(repo, form)
  if (!('plan' in planned)) throw new Error(`expected a plan, got: ${planned.missing}`)
  return planned.plan
}

describe('label logic', () => {
  test('Push when there is nothing to commit', () => {
    expect(planOf(REPO, { message: '' }).label).toBe('Push')
  })

  test('Commit and push when there are changes', () => {
    expect(planOf(DIRTY, { message: 'Fix it' }).label).toBe('Commit and push')
  })

  test('Create repo and push for a new repo with nothing to commit', () => {
    const form: GitPanelForm = { message: '', repo: NEW_REPO, visibility: 'private' }
    expect(planOf(REPO, form).label).toBe('Create repo and push')
  })

  test('Create repo, commit and push when a new repo also gets a commit', () => {
    expect(primaryLabel(true, true)).toBe('Create repo, commit and push')
  })

  test('a new repo has no plan until visibility is chosen', () => {
    expect(planFrom(REPO, { message: '', repo: NEW_REPO })).toEqual({
      missing: 'Choose whether the new repository is private or public.',
    })
  })

  test('changes need a commit message', () => {
    expect(planFrom(DIRTY, { message: '  ' })).toEqual({ missing: 'Write a commit message.' })
  })

  test('a branch error blocks the plan', () => {
    const form: GitPanelForm = { message: '', branch: NEW_BRANCH, newBranchName: 'a..b', branchError: 'bad' }
    expect(planFrom(REPO, form)).toEqual({ missing: 'bad' })
  })
})

describe('repo choice', () => {
  test('preselects the GitHub repo origin points at', () => {
    expect(defaultRepoChoice(REPO)).toBe('octocat/app')
  })

  test('offers the current remote when gh is unavailable', () => {
    expect(defaultRepoChoice({ ...REPO, github: { isAvailable: false, reason: 'no gh' } })).toBe(CURRENT_REMOTE)
  })

  test('reads owner/name from https, ssh and scp URLs', () => {
    expect(githubSlug('https://github.com/A/b.git')).toBe('a/b')
    expect(githubSlug('ssh://git@github.com/A/b')).toBe('a/b')
    expect(githubSlug('git@github.com:A/b.git')).toBe('a/b')
    expect(githubSlug('https://gitlab.com/A/b')).toBeNull()
  })

  test('a free remote name never collides', () => {
    expect(freeRemoteName('app', [{ name: 'app', url: 'x' }, { name: 'app-2', url: 'y' }])).toBe('app-3')
  })
})

describe('co-author line', () => {
  test('is appended when missing', () => {
    expect(withCoAuthor('Fix the thing\n')).toBe(`Fix the thing\n\n${CO_AUTHOR}`)
  })

  test('is not doubled when already last', () => {
    expect(withCoAuthor(`Fix\n\n${CO_AUTHOR}\n`)).toBe(`Fix\n\n${CO_AUTHOR}`)
  })

  test('is in the commit command', () => {
    const plan = planOf(DIRTY, { message: 'Fix it' })
    const decision = remoteDecision(DIRTY, plan)
    if (!('setup' in decision)) throw new Error('expected a direct setup')
    const commit = buildSteps(DIRTY, plan, decision.setup, 'Fix it').find(step => step.label === 'Commit')
    expect(commit && stepArgv(commit, '')).toEqual(['git', 'commit', '-m', `Fix it\n\n${CO_AUTHOR}`])
  })
})

describe('never force', () => {
  test('the guard catches every force spelling', () => {
    for (const flag of ['-f', '--force', '--force-with-lease', '--force-if-includes', '-uf', '+main']) {
      expect(isForcePush(['git', 'push', 'origin', flag]), flag).toBe(true)
    }
    expect(isForcePush(['git', 'push', '-u', 'origin', 'main'])).toBe(false)
  })

  test('no built run ever force pushes', () => {
    const forms: GitPanelForm[] = [
      { message: 'm' },
      { message: 'm', branch: 'dev' },
      { message: 'm', branch: NEW_BRANCH, newBranchName: 'feature/x' },
      { message: 'm', repo: 'octocat/other' },
      { message: 'm', repo: NEW_REPO, visibility: 'public' },
    ]
    let pushes = 0
    for (const repo of [REPO, DIRTY, { ...REPO, remotes: [] }]) {
      for (const form of forms) {
        const planned = planFrom(repo, form)
        // A repo with no remote has no plan until a repo is picked; nothing to build there.
        if (!('plan' in planned)) continue
        const { plan } = planned
        const decision = remoteDecision(repo, plan)
        const setups = 'setup' in decision ? [decision.setup] : decision.choices.map(choice => choice.setup)
        for (const setup of setups) {
          for (const step of buildSteps(repo, plan, setup, 'm')) {
            const argv = stepArgv(step, 'https://github.com/octocat/app')
            expect(isForcePush(argv), argv.join(' ')).toBe(false)
            expect(argv.includes('-f') || argv.includes('--force')).toBe(false)
            if (argv.includes('push')) pushes += 1
          }
        }
      }
    }
    expect(pushes).toBeGreaterThan(10)
  })
})

describe('confirmation', () => {
  test('lists the files a commit takes, 15 at most, then how many more', () => {
    const many: GitPanelRepo = { ...REPO, files: Array.from({ length: 18 }, (_, i) => ` M src/file${i}.ts`) }
    const text = confirmationText(planOf(many, { message: 'Fix it' }), many, 'origin', 'Fix it')
    expect(text).toContain('Files:\n- src/file0.ts')
    expect(text).toContain('- src/file14.ts\nand 3 more')
    expect(text).not.toContain('src/file15.ts')
    expect(text).toContain(`Commit message:\nFix it\n\n${CO_AUTHOR}`)
  })

  test('warns about names that look like secrets', () => {
    expect(riskyFiles(['.env.local', 'certs/server.pem', 'a.key', 'id_ed25519.pub', 'store.p12', 'config/credentials.json', 'src/env.ts'])).toEqual([
      '.env.local',
      'certs/server.pem',
      'a.key',
      'id_ed25519.pub',
      'store.p12',
      'config/credentials.json',
    ])
    const dirty: GitPanelRepo = { ...REPO, files: ['?? .env', ' M src/a.ts'] }
    expect(confirmationText(planOf(dirty, { message: 'm' }), dirty, 'origin', 'm')).toContain('⚠ These look like secrets: .env.')
  })

  test('warns when the repository is public, or will be created public', () => {
    const publicRepo: GitPanelRepo = { ...REPO, github: { isAvailable: true, repos: [{ nameWithOwner: 'octocat/app', isPrivate: false, url: 'https://github.com/octocat/app' }] } }
    expect(confirmationText(planOf(publicRepo, { message: '' }), publicRepo, 'origin', '')).toContain('⚠ This repository is public')
    expect(confirmationText(planOf(REPO, { message: '' }), REPO, 'origin', '')).not.toContain('public')
    const created = planOf(REPO, { message: '', repo: NEW_REPO, visibility: 'public' })
    expect(confirmationText(created, REPO, 'origin', '')).toContain('⚠ The new repository will be public')
  })

  test('reads the path of a porcelain line, the new one for a rename', () => {
    expect(changedPath(' M src/a.ts')).toBe('src/a.ts')
    expect(changedPath('R  old.ts -> new.ts')).toBe('new.ts')
    expect(changedPath('?? "with space.txt"')).toBe('with space.txt')
  })
})

describe('names', () => {
  test('a repository or remote name can never be read as an option', () => {
    expect(isSafeName('my-app.v2_x')).toBe(true)
    expect(isSafeName('-x')).toBe(false)
    expect(isSafeName('a b')).toBe(false)
    expect(planFrom(REPO, { message: '', repo: NEW_REPO, newRepoName: '--help', visibility: 'private' })).toEqual({
      missing: 'Use letters, digits, dots, dashes or underscores for the repository name, not starting with a dash.',
    })
  })

  test('names follow -- in the commands that take it', () => {
    const plan = planOf(REPO, { message: '', branch: 'dev' })
    const decision = remoteDecision(REPO, plan)
    if (!('setup' in decision)) throw new Error('expected a direct setup')
    const argvs = buildSteps(REPO, plan, decision.setup, 'm').map(step => stepArgv(step, ''))
    expect(argvs).toContainEqual(['git', 'switch', '--', 'dev'])
    expect(argvs).toContainEqual(['git', 'push', '-u', '--', 'origin', 'dev'])
    const created = planOf(REPO, { message: '', repo: NEW_REPO, visibility: 'private', newRepoName: 'fresh' })
    const choices = remoteDecision(REPO, created)
    if ('setup' in choices) throw new Error('expected a question, origin exists')
    const createArgv = stepArgv(buildSteps(REPO, created, choices.choices[0]!.setup, 'm')[0]!, '')
    expect(createArgv.slice(-2)).toEqual(['--', 'fresh'])
  })
})
