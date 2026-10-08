import type { RenderElement, RenderNode } from 'claude-code'

import type { GitPanelForm, GitPanelRepo, GitPanelSnapshot, GitPanelStep } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { CURRENT_REMOTE, NEW_BRANCH, NEW_REPO, defaultRepoChoice, filesPhrase, originOf, planFrom } from './plan'

const MAX_FILES = 12

export type GitModel = {
  snapshot: GitPanelSnapshot
  form: GitPanelForm
  log: GitPanelStep[]
  isBusy: boolean
  setForm: (change: Partial<GitPanelForm>) => void
  checkNewBranch: (name: string) => void
  push: () => void
  refresh: () => void
  init: (cwd: string) => void
  close: () => void
}

export function gitPanel(kit: Kit, model: GitModel, columns: number): RenderElement {
  return panel(kit, 'git', columns, snapshotBody(kit.t, model), model.close)
}

export function gitPlain(snapshot: GitPanelSnapshot): string[] {
  if (snapshot.kind !== 'repo') return ['Git panel works in the terminal and the desktop app.']
  const changes = snapshot.files.length === 0 ? 'no uncommitted changes' : filesPhrase(snapshot.files.length)
  return [`Branch ${snapshot.branch || 'detached HEAD'}, ${changes}. Pushing works in the terminal and the desktop app.`]
}

function snapshotBody(t: Rich, model: GitModel): (RenderNode | null)[] {
  const { Text, Button } = t
  const { snapshot } = model
  if (snapshot.kind === 'loading') return [<Text color={COLORS.muted}>Reading the repository…</Text>]
  if (snapshot.kind === 'error') return [<Text color={COLORS.alarm}>{snapshot.message}</Text>]
  if (snapshot.kind === 'not-repo') {
    return [
      <Text>This folder is not a git repository.</Text>,
      buttonRow(t, 'init-actions', [
        <Button key="init" variant="primary" label="+ Initialize repository" onPress={() => model.init(snapshot.cwd)} />,
      ]),
      logBlock(t, model.log),
    ]
  }
  return [
    statusBlock(t, snapshot),
    changesBlock(t, model, snapshot),
    targetBlock(t, model, snapshot),
    actionRow(t, model, snapshot),
    logBlock(t, model.log),
  ]
}

function block(t: Rich, title: string, children: RenderNode[]): RenderElement {
  const { Box, Text } = t
  return (
    <Box key={`block-${title.split(' ')[0]}`} flexDirection="column" borderStyle="round" borderColor={COLORS.plate} paddingX={1}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  )
}

function statusBlock(t: Rich, repo: GitPanelRepo): RenderElement {
  const { Text } = t
  const tracking = repo.upstream
    ? `${repo.ahead} ahead, ${repo.behind} behind ${repo.upstream}`
    : 'No upstream yet: the first push sets it.'
  return block(t, 'Status', [
    <Text>
      Branch <Text color={COLORS.spo2}>{repo.branch || 'detached HEAD'}</Text>
    </Text>,
    <Text color={COLORS.muted}>{tracking}</Text>,
    ...(repo.remotes.length === 0
      ? [<Text color={COLORS.muted}>No remotes.</Text>]
      : repo.remotes.map(remote => <Text color={COLORS.muted} wrap="truncate-end">{`${remote.name}  ${remote.url}`}</Text>)),
  ])
}

function changesBlock(t: Rich, model: GitModel, repo: GitPanelRepo): RenderElement {
  const { Text, Input } = t
  const { form } = model
  if (repo.files.length === 0) return block(t, 'Changes', [<Text color={COLORS.muted}>No uncommitted changes.</Text>])
  const shown = repo.files.slice(0, MAX_FILES).map(line => <Text wrap="truncate-end">{line}</Text>)
  const more = repo.files.length - MAX_FILES
  return block(t, `Changes (${filesPhrase(repo.files.length)})`, [
    ...shown,
    ...(more > 0 ? [<Text color={COLORS.muted}>{`and ${more} more`}</Text>] : []),
    <Input
      key="message"
      label="Commit message"
      placeholder="Describe the change"
      value={form.message}
      onInput={value => model.setForm({ message: value })}
      onSubmit={value => model.setForm({ message: value })}
    />,
    <Text color={COLORS.muted}>The Co-Authored-By line for Claude is added on commit.</Text>,
    ...(form.ledgerNote ? [<Text color={COLORS.resp}>{form.ledgerNote}</Text>] : []),
  ])
}

function repoOptions(repo: GitPanelRepo) {
  const origin = originOf(repo)
  if (!repo.github.isAvailable) {
    return origin ? [{ value: CURRENT_REMOTE, label: `Current origin: ${origin.url}` }] : []
  }
  const listed = repo.github.repos.map(one => ({
    value: one.nameWithOwner,
    label: `${one.nameWithOwner} (${one.isPrivate ? 'private' : 'public'})`,
  }))
  const choice = defaultRepoChoice(repo)
  const keepOrigin = origin && choice === CURRENT_REMOTE ? [{ value: CURRENT_REMOTE, label: `Current origin: ${origin.url}` }] : []
  return [{ value: NEW_REPO, label: 'Create new repo…' }, ...keepOrigin, ...listed]
}

function newRepoFields(t: Rich, model: GitModel, repo: GitPanelRepo): RenderNode[] {
  const { Input, Select, Text } = t
  const { form } = model
  return [
    <Input
      key="repo-name"
      label="Name"
      value={form.newRepoName ?? repo.folderName}
      onInput={value => model.setForm({ newRepoName: value })}
      onSubmit={value => model.setForm({ newRepoName: value })}
    />,
    <Select
      key="visibility"
      label="Visibility"
      options={[
        { value: 'private', label: 'Private' },
        { value: 'public', label: 'Public' },
      ]}
      value={form.visibility}
      onSelect={value => model.setForm({ visibility: value === 'public' ? 'public' : 'private' })}
    />,
    ...(form.visibility ? [] : [<Text color={COLORS.resp}>Choose Private or Public.</Text>]),
  ]
}

function branchFields(t: Rich, model: GitModel, repo: GitPanelRepo): RenderNode[] {
  const { Input, Select, Text } = t
  const { form } = model
  const choice = form.branch ?? (repo.branch || undefined)
  const options = [...repo.branches.map(name => ({ value: name })), { value: NEW_BRANCH, label: 'New branch…' }]
  return [
    <Select
      key="branch"
      label="Branch"
      options={options}
      value={choice}
      onSelect={value => model.setForm({ branch: value, branchError: undefined })}
    />,
    ...(choice === NEW_BRANCH
      ? [
          <Input
            key="branch-name"
            label="New branch"
            placeholder="feature/name"
            value={form.newBranchName ?? ''}
            onInput={value => model.setForm({ newBranchName: value, branchError: undefined })}
            onSubmit={model.checkNewBranch}
          />,
        ]
      : []),
    ...(form.branchError ? [<Text color={COLORS.alarm}>{form.branchError}</Text>] : []),
  ]
}

function targetBlock(t: Rich, model: GitModel, repo: GitPanelRepo): RenderElement {
  const { Select, Text } = t
  const options = repoOptions(repo)
  const choice = model.form.repo ?? defaultRepoChoice(repo)
  const notes = repo.github.isAvailable ? [] : [<Text color={COLORS.resp}>{repo.github.reason}</Text>]
  const repoField =
    options.length === 0
      ? [<Text color={COLORS.muted}>No remote to push to.</Text>]
      : [<Select key="repo" label="Repository" options={options} value={choice} onSelect={value => model.setForm({ repo: value })} />]
  return block(t, 'Push to', [
    ...notes,
    ...repoField,
    ...(choice === NEW_REPO ? newRepoFields(t, model, repo) : []),
    ...branchFields(t, model, repo),
  ])
}

function actionRow(t: Rich, model: GitModel, repo: GitPanelRepo): RenderElement {
  const { Box, Button, Text } = t
  const planned = planFrom(repo, model.form)
  const refresh = <Button key="refresh" label="↻ Refresh" onPress={model.refresh} />
  if (model.isBusy) return buttonRow(t, 'git-actions', [<Text color={COLORS.muted}>Working…</Text>, refresh])
  if (!('plan' in planned)) {
    return (
      <Box key="git-missing" flexDirection="column" gap={1}>
        <Text color={COLORS.muted}>{planned.missing}</Text>
        {buttonRow(t, 'git-actions', [refresh])}
      </Box>
    )
  }
  return buttonRow(t, 'git-actions', [
    <Button key="primary" variant="primary" label={`↑ ${planned.plan.label}`} onPress={model.push} />,
    refresh,
  ])
}

function logBlock(t: Rich, log: GitPanelStep[]): RenderElement | null {
  const { Text } = t
  if (log.length === 0) return null
  return block(
    t,
    'Last run',
    log.map(step => (
      <Text color={step.isOk ? COLORS.ecg : COLORS.alarm}>{step.detail === 'ok' ? `ok  ${step.label}` : `${step.label}: ${step.detail}`}</Text>
    )),
  )
}
