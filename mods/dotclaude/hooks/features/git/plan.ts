import type { GitPanelForm, GitPanelRemote, GitPanelRepo } from '../../../types'

export const CO_AUTHOR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
export const NEW_REPO = '__new__'
export const CURRENT_REMOTE = '__current__'
export const NEW_BRANCH = '__new__'

/** Where the push goes, before any remote has been touched. */
export type RepoTarget =
  | { kind: 'current'; remote: GitPanelRemote }
  | { kind: 'existing'; nameWithOwner: string; url: string }
  | { kind: 'create'; name: string; visibility: 'private' | 'public' }

export type BranchTarget = { kind: 'current' | 'switch' | 'create'; name: string }

export type Plan = { target: RepoTarget; branch: BranchTarget; commit: boolean; label: string }

/** A plan, or the one thing still to fill in before there is one. */
export type PlanOrMissing = { plan: Plan } | { missing: string }

/** `owner/name` of a GitHub remote URL (https, ssh or scp form), lowercased; else null. */
export function githubSlug(url: string): string | null {
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return match ? match[1].toLowerCase() : null
}

export function originOf(repo: GitPanelRepo): GitPanelRemote | undefined {
  return repo.remotes.find(remote => remote.name === 'origin')
}

/** The repo option shown selected while none is picked. */
export function defaultRepoChoice(repo: GitPanelRepo): string | undefined {
  const origin = originOf(repo)
  if (!origin) return undefined
  if (!repo.github.isAvailable) return CURRENT_REMOTE
  const slug = githubSlug(origin.url)
  const match = repo.github.repos.find(one => one.nameWithOwner.toLowerCase() === slug)
  return match ? match.nameWithOwner : CURRENT_REMOTE
}

export function primaryLabel(isCreate: boolean, commit: boolean): string {
  if (isCreate) return commit ? 'Create repo, commit and push' : 'Create repo and push'
  return commit ? 'Commit and push' : 'Push'
}

const PICK_REPO = 'Pick a repository to push to.'

function pickedGitHubTarget(repo: GitPanelRepo, choice: string): RepoTarget | string {
  if (!repo.github.isAvailable) return PICK_REPO
  const picked = repo.github.repos.find(one => one.nameWithOwner === choice)
  if (!picked) return PICK_REPO
  const origin = originOf(repo)
  if (origin && githubSlug(origin.url) === picked.nameWithOwner.toLowerCase()) {
    return { kind: 'current', remote: origin }
  }
  return { kind: 'existing', nameWithOwner: picked.nameWithOwner, url: picked.url }
}

function repoTarget(repo: GitPanelRepo, form: GitPanelForm): RepoTarget | string {
  const choice = form.repo ?? defaultRepoChoice(repo)
  if (choice === undefined) return PICK_REPO
  if (choice === CURRENT_REMOTE) {
    const origin = originOf(repo)
    return origin ? { kind: 'current', remote: origin } : PICK_REPO
  }
  if (choice !== NEW_REPO) return pickedGitHubTarget(repo, choice)
  const name = (form.newRepoName ?? repo.folderName).trim()
  if (name === '') return 'Name the new repository.'
  if (!isSafeName(name)) return 'Use letters, digits, dots, dashes or underscores for the repository name, not starting with a dash.'
  if (!form.visibility) return 'Choose whether the new repository is private or public.'
  return { kind: 'create', name, visibility: form.visibility }
}

function branchTarget(repo: GitPanelRepo, form: GitPanelForm): BranchTarget | string {
  const choice = form.branch ?? (repo.branch || undefined)
  if (choice === undefined) return 'Pick a branch to push.'
  if (choice === NEW_BRANCH) {
    const name = (form.newBranchName ?? '').trim()
    return name === '' ? 'Name the new branch.' : { kind: 'create', name }
  }
  return { kind: choice === repo.branch ? 'current' : 'switch', name: choice }
}

export function planFrom(repo: GitPanelRepo, form: GitPanelForm): PlanOrMissing {
  const target = repoTarget(repo, form)
  if (typeof target === 'string') return { missing: target }
  const branch = branchTarget(repo, form)
  if (typeof branch === 'string') return { missing: branch }
  if (form.branchError) return { missing: form.branchError }
  const commit = repo.files.length > 0
  if (commit && form.message.trim() === '') return { missing: 'Write a commit message.' }
  return { plan: { target, branch, commit, label: primaryLabel(target.kind === 'create', commit) } }
}

/** The message as committed: always ending with Claude's co-author line. */
export function withCoAuthor(message: string): string {
  const trimmed = message.trimEnd()
  if (trimmed.endsWith(CO_AUTHOR)) return trimmed
  return `${trimmed}\n\n${CO_AUTHOR}`
}

/** A remote name no existing remote uses: `base`, else `base-2`, `base-3`, ... */
export function freeRemoteName(base: string, remotes: readonly GitPanelRemote[]): string {
  const taken = new Set(remotes.map(remote => remote.name))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * True when argv would push with force in any spelling git accepts: `--force`,
 * `--force-with-lease`, `--force-if-includes`, `-f` alone or in a flag cluster,
 * or a `+refspec`. The panel never builds one; this guard makes that checkable.
 */
export function isForcePush(argv: readonly string[]): boolean {
  if (!argv.includes('push')) return false
  return argv.some(arg => arg.startsWith('--force') || /^-[a-zA-Z]*f/.test(arg) || arg.startsWith('+'))
}

export function filesPhrase(count: number): string {
  return count === 1 ? '1 changed file' : `${count} changed files`
}

function repoPhrase(target: RepoTarget): string {
  if (target.kind === 'create') return `a new ${target.visibility} repo ${target.name}`
  if (target.kind === 'existing') return target.nameWithOwner
  return target.remote.url
}

function branchPhrase(branch: BranchTarget): string {
  if (branch.kind === 'create') return `new branch ${branch.name}`
  if (branch.kind === 'switch') return `branch ${branch.name} (switching to it first)`
  return `branch ${branch.name}`
}

/** The confirmation question: repo, branch, remote, and whether a commit is made. */
export function describePlan(plan: Plan, fileCount: number, remote: string): string {
  const commitText = plan.commit
    ? `committing ${filesPhrase(fileCount)} first`
    : 'with no commit (nothing has changed)'
  return `Push ${branchPhrase(plan.branch)} to ${repoPhrase(plan.target)} through remote ${remote}, ${commitText}?`
}

/** A repository or remote name git and gh take as a name, never as an option. */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith('-')
}

const FILES_SHOWN = 15
// Names that usually hold a secret: worth a second look before they are pushed.
const RISKY_NAMES = [/^\.env/i, /\.pem$/i, /\.key$/i, /^id_(rsa|ed25519)/i, /\.p12$/i, /^credentials/i]

/** The path a `git status --porcelain` line names: the new one for a rename, quotes removed. */
export function changedPath(line: string): string {
  const path = line.slice(3)
  const renamed = path.includes(' -> ') ? path.slice(path.lastIndexOf(' -> ') + 4) : path
  return renamed.replace(/^"|"$/g, '')
}

export function riskyFiles(paths: readonly string[]): string[] {
  return paths.filter(path => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return RISKY_NAMES.some(pattern => pattern.test(name))
  })
}

/** Whether the push lands in a public repository, as far as gh says; unknown counts as not. */
export function isPublicTarget(repo: GitPanelRepo, plan: Plan): boolean {
  const { target } = plan
  if (target.kind === 'create') return target.visibility === 'public'
  if (!repo.github.isAvailable) return false
  const slug = target.kind === 'existing' ? target.nameWithOwner.toLowerCase() : githubSlug(target.remote.url)
  return repo.github.repos.some(one => one.nameWithOwner.toLowerCase() === slug && !one.isPrivate)
}

/**
 * The one confirmation before anything is written: where it goes, the files a commit takes
 * (the first 15), warnings for secret-looking names and a public repository, and the
 * commit message as it will be committed.
 */
export function confirmationText(plan: Plan, repo: GitPanelRepo, remote: string, message: string): string {
  const paths = repo.files.map(changedPath)
  const risky = plan.commit ? riskyFiles(paths) : []
  const shown = paths.slice(0, FILES_SHOWN).map(path => `- ${path}`)
  const more = paths.length - FILES_SHOWN
  return [
    describePlan(plan, repo.files.length, remote),
    ...(plan.commit ? ['', 'Files:', ...shown, ...(more > 0 ? [`and ${more} more`] : [])] : []),
    ...(risky.length > 0 ? ['', `⚠ These look like secrets: ${risky.join(', ')}. Check them before pushing.`] : []),
    ...(isPublicTarget(repo, plan)
      ? ['', plan.target.kind === 'create' ? '⚠ The new repository will be public: anyone can read what you push.' : '⚠ This repository is public: anyone can read what you push.']
      : []),
    ...(plan.commit ? ['', 'Commit message:', withCoAuthor(message)] : []),
  ].join('\n')
}
