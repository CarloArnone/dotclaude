import type { GitPanelRepo } from '../../../types'
import { GH_TIMEOUT_MS, LOCAL_TIMEOUT_MS, PUSH_TIMEOUT_MS } from './git'
import type { Step } from './git'
import { freeRemoteName, githubSlug, isSafeName, originOf, withCoAuthor } from './plan'
import type { BranchTarget, Plan, RepoTarget } from './plan'

/** Which remote the push goes through, the repo's name for the toast, and the remote commands first. */
export type RemoteSetup = { remote: string; repoName: string; steps: Step[] }

/** Either the setup is clear, or the person must answer a question whose options each carry a setup. */
export type RemoteDecision =
  | { setup: RemoteSetup }
  | { question: string; choices: { label: string; setup: RemoteSetup }[] }

function addRemoteStep(name: string, url: string): Step {
  return {
    label: `Add remote ${name}`,
    argv: ['git', 'remote', 'add', '--', name, url],
    timeoutMs: LOCAL_TIMEOUT_MS,
    undo: ['git', 'remote', 'remove', '--', name],
  }
}

function setOriginStep(oldUrl: string, newUrl: (previousStdout: string) => string): Step {
  return {
    label: 'Point origin at the repository',
    argv: previousStdout => ['git', 'remote', 'set-url', '--', 'origin', newUrl(previousStdout)],
    timeoutMs: LOCAL_TIMEOUT_MS,
    undo: ['git', 'remote', 'set-url', '--', 'origin', oldUrl],
  }
}

function createStep(repo: GitPanelRepo, target: Extract<RepoTarget, { kind: 'create' }>, remote?: string): Step {
  const label = `Create ${target.visibility} repo ${target.name}`
  // Flags first, then `--`, so a name can never be read as one.
  const flags = ['gh', 'repo', 'create', `--${target.visibility}`]
  if (!remote) return { label, argv: [...flags, '--', target.name], timeoutMs: GH_TIMEOUT_MS }
  return {
    label,
    argv: [...flags, '--source', repo.root, '--remote', remote, '--', target.name],
    timeoutMs: GH_TIMEOUT_MS,
    // The GitHub repo itself is never deleted; only the local remote gh added is taken back.
    undo: ['git', 'remote', 'remove', '--', remote],
  }
}

function existingDecision(repo: GitPanelRepo, target: Extract<RepoTarget, { kind: 'existing' }>): RemoteDecision {
  const repoName = target.nameWithOwner
  const slug = repoName.toLowerCase()
  const already = repo.remotes.find(remote => githubSlug(remote.url) === slug)
  if (already) return { setup: { remote: already.name, repoName, steps: [] } }
  const origin = originOf(repo)
  if (!origin) return { setup: { remote: 'origin', repoName, steps: [addRemoteStep('origin', target.url)] } }
  const base = repoName.split('/')[1] ?? ''
  const free = freeRemoteName(isSafeName(base) ? base : 'github', repo.remotes)
  return {
    question: `origin points at ${origin.url}. Point origin at ${repoName} instead, or add it as remote ${free}?`,
    choices: [
      { label: 'Update origin', setup: { remote: 'origin', repoName, steps: [setOriginStep(origin.url, () => target.url)] } },
      { label: `Add remote ${free}`, setup: { remote: free, repoName, steps: [addRemoteStep(free, target.url)] } },
    ],
  }
}

function createDecision(repo: GitPanelRepo, target: Extract<RepoTarget, { kind: 'create' }>): RemoteDecision {
  const repoName = target.name
  const origin = originOf(repo)
  if (!origin) return { setup: { remote: 'origin', repoName, steps: [createStep(repo, target, 'origin')] } }
  const free = freeRemoteName(target.name, repo.remotes)
  // gh refuses --remote origin while origin exists, so replacing creates bare and re-points origin at the URL gh prints.
  const replace = [createStep(repo, target), setOriginStep(origin.url, previousStdout => previousStdout.trim())]
  return {
    question: `origin already points at ${origin.url}. Add the new repo as remote ${free}, or replace origin?`,
    choices: [
      { label: `Add remote ${free}`, setup: { remote: free, repoName, steps: [createStep(repo, target, free)] } },
      { label: 'Replace origin', setup: { remote: 'origin', repoName, steps: replace } },
    ],
  }
}

export function remoteDecision(repo: GitPanelRepo, plan: Plan): RemoteDecision {
  const { target } = plan
  if (target.kind === 'existing') return existingDecision(repo, target)
  if (target.kind === 'create') return createDecision(repo, target)
  const repoName = githubSlug(target.remote.url) ?? target.remote.url
  return { setup: { remote: target.remote.name, repoName, steps: [] } }
}

function branchSteps(repo: GitPanelRepo, branch: BranchTarget): Step[] {
  if (branch.kind === 'current') return []
  const back = repo.branch ? { undo: ['git', 'switch', '--', repo.branch] } : {}
  const isCreate = branch.kind === 'create'
  return [
    {
      label: isCreate ? `Create branch ${branch.name}` : `Switch to ${branch.name}`,
      argv: isCreate ? ['git', 'switch', '-c', branch.name] : ['git', 'switch', '--', branch.name],
      timeoutMs: LOCAL_TIMEOUT_MS,
      ...back,
    },
  ]
}

/** Porcelain's first column is the index: anything there but blank or `?` was staged by hand. */
function hasStagedChanges(repo: GitPanelRepo): boolean {
  return repo.files.some(line => line[0] !== ' ' && line[0] !== '?')
}

function commitSteps(repo: GitPanelRepo, message: string): Step[] {
  // Unstaging is an exact undo only when nothing was staged before the run.
  const unstage = hasStagedChanges(repo) ? {} : { undo: ['git', 'reset', '-q'] }
  return [
    { label: 'Stage all changes', argv: ['git', 'add', '-A'], timeoutMs: LOCAL_TIMEOUT_MS, ...unstage },
    { label: 'Commit', argv: ['git', 'commit', '-m', withCoAuthor(message)], timeoutMs: LOCAL_TIMEOUT_MS },
  ]
}

/** Every command of a run, in order: remote, branch, commit (when there are changes), push. */
export function buildSteps(repo: GitPanelRepo, plan: Plan, setup: RemoteSetup, message: string): Step[] {
  return [
    ...setup.steps,
    ...branchSteps(repo, plan.branch),
    ...(plan.commit ? commitSteps(repo, message) : []),
    {
      label: `Push ${plan.branch.name} to ${setup.remote}`,
      argv: ['git', 'push', '-u', '--', setup.remote, plan.branch.name],
      timeoutMs: PUSH_TIMEOUT_MS,
    },
  ]
}
