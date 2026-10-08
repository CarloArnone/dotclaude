// What every test shares: the workspace pane's mount target and the host calls
// opening a view makes. The kit has no engine beneath the plugin, so a test answers them.

import type { On } from 'claude-code'

export const SURFACES = ['terminal', 'desktop'] as const
export const PLAIN_SURFACES = ['vscode', 'mobile'] as const

export function paneProps(bodyColumns = 80, bodyRows = 40) {
  return {
    title: 'Workspace',
    isFocused: false,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows },
    view: {},
  }
}

export const WORKSPACE = { plugin: 'dotclaude', component: 'Pane', requestId: 'workspace', props: paneProps() } as const

export type Ui = { toasts: string[]; opened: string[]; panes: string[]; commandsRun: string[] }

/**
 * The host's pane, toast and log calls, recorded. `commandsRun` collects every command
 * that reaches the bottom: the plugin answers its own, so anything here was run by the plugin.
 */
export function answerUi(on: On): Ui {
  const ui: Ui = { toasts: [], opened: [], panes: [], commandsRun: [] }
  on('ui.open', (_$, e) => {
    ui.opened.push(e.id)
    if (!ui.panes.includes(e.id)) ui.panes.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    ui.panes = ui.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: ui.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', (_$, e) => {
    ui.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', () => ({ value: { agent: 'dotclaude:scribe' } }))
  on('command.run', (_$, e) => {
    ui.commandsRun.push(`/${e.command} ${e.args ?? ''}`.trim())
    return { text: '' }
  })
  return ui
}
