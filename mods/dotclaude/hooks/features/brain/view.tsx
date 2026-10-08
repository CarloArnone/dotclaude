import type { RenderElement } from 'claude-code'

import type { CaptureState, NoteRef, SearchResult, VaultView } from '../../../types'
import { buttonRow, panel } from '../../ui/chrome'
import type { Kit, Rich } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'
import { noteName, obsidianUrl, relativeTime } from './vault'

export type BrainModel = {
  view: VaultView | null
  search: SearchResult
  capture: CaptureState
  nowMs: number
  runSearch: (query: string) => void
  openNote: (url: string) => void
  startCapture: () => void
  close: () => void
}

/** What every drawing helper needs: the elements, the vault, and how a note opens on this surface. */
type Draw = {
  t: Rich
  vault: string
  /** The terminal opens an `obsidian:` Link itself; the desktop draws only https links, so a Button opens it. */
  linksOpen: boolean
  open: (url: string) => void
}

export function brainPanel(kit: Kit, model: BrainModel, columns: number): RenderElement {
  const { Input, Text } = kit.t
  const draw: Draw = {
    t: kit.t,
    vault: model.view?.vaultName ?? '',
    linksOpen: kit.surface === 'terminal',
    open: model.openNote,
  }
  return panel(
    kit,
    'brain',
    columns,
    [
      <Input key="search" placeholder="Search the vault" value={model.search.query} onSubmit={model.runSearch} />,
      model.search.query !== '' ? searchSection(draw, model.search) : null,
      model.view === null ? <Text dimColor>Reading the vault…</Text> : null,
      model.view?.missingPath ? <Text color={COLORS.resp}>{missingVault(model.view.missingPath)}</Text> : null,
      model.view !== null && model.view.missingPath === null ? vaultSections(draw, model.view, model.nowMs) : null,
      model.view?.missingPath ? null : captureBlock(draw, model.capture, model.startCapture),
    ],
    model.close,
  )
}

export function brainPlain(view: VaultView | null, capture: CaptureState): string[] {
  if (view === null) return ['Second brain: reading the vault.']
  if (view.missingPath !== null) return [missingVault(view.missingPath)]
  const today = view.today.exists ? `${view.today.captures} captures today` : 'no daily note yet'
  return [`Second brain: ${view.inbox.length} in inbox, ${today}, capture ${capture.phase}.`]
}

function missingVault(path: string): string {
  return `No notes vault at ${path}. Set vaultPath in the plugin's options (/config) to your notes folder.`
}

function section(d: Draw, title: string, rows: RenderElement[], empty: string): RenderElement {
  const { Box, Text } = d.t
  return (
    <Box key={`section-${title}`} flexDirection="column">
      <Text bold color={COLORS.spo2}>
        {title}
      </Text>
      {rows.length === 0 ? <Text dimColor>{empty}</Text> : rows}
    </Box>
  )
}

/** `where` keeps keys unique when one note shows in several sections. */
function noteLink(d: Draw, where: string, path: string): RenderElement {
  const { Button, Link } = d.t
  const url = obsidianUrl(d.vault, path)
  if (d.linksOpen) return <Link href={url} label={noteName(path)} />

  return <Button key={`${where}:${path}`} plain label={noteName(path)} onPress={() => d.open(url)} />
}

function noteRow(d: Draw, where: string, note: NoteRef, nowMs: number): RenderElement {
  const { Box, Text } = d.t
  return (
    <Box key={`row-${where}:${note.path}`} flexDirection="row" gap={1}>
      {noteLink(d, where, note.path)}
      <Text color={COLORS.muted}>{relativeTime(note.mtimeMs, nowMs)}</Text>
    </Box>
  )
}

function searchSection(d: Draw, search: SearchResult): RenderElement {
  return section(d, 'Results', search.hits.map(path => noteLink(d, 'result', path)), `No notes match "${search.query}".`)
}

function vaultSections(d: Draw, view: VaultView, nowMs: number): RenderElement {
  const { Box, Text } = d.t
  const { today } = view
  const todayRow = today.exists ? (
    <Box key="today-row" flexDirection="row" gap={1}>
      {noteLink(d, 'today', today.path)}
      <Text color={COLORS.muted}>{today.captures === 1 ? '1 capture' : `${today.captures} captures`}</Text>
    </Box>
  ) : (
    <Text dimColor>No daily note yet.</Text>
  )

  return (
    <Box key="vault-sections" flexDirection="column" gap={1}>
      {section(d, 'Inbox', view.inbox.map(note => noteRow(d, 'inbox', note, nowMs)), 'Inbox is empty.')}
      {section(d, 'Today', [todayRow], '')}
      {section(d, 'Recent notes', view.recent.map(note => noteRow(d, 'recent', note, nowMs)), 'No notes yet.')}
    </Box>
  )
}

function captureBlock(d: Draw, capture: CaptureState, onCapture: () => void): RenderElement {
  const { Box, Button, Text } = d.t
  switch (capture.phase) {
    case 'idle':
      return buttonRow(d.t, 'capture-actions', [<Button key="capture" variant="primary" label="+ Capture this session" onPress={onCapture} />])
    case 'working':
      return (
        <Box key="capture-working" flexDirection="column">
          <Text bold>{capture.stage === 'draft' ? 'Scribe is reading the session…' : 'Scribe is writing the notes…'}</Text>
          <Text color={COLORS.muted}>Extracting decisions, facts and open questions.</Text>
        </Box>
      )
    case 'question':
      return (
        <Box key="capture-question" flexDirection="column" borderStyle="round" borderColor={COLORS.lock} paddingX={1}>
          <Text bold>
            {capture.total > 1 ? `The scribe has a question (${capture.position} of ${capture.total})` : 'The scribe has a question'}
          </Text>
          <Text>{capture.question.question}</Text>
          <Text color={COLORS.muted}>Answer in the dialog: {capture.question.options.join(', ')}.</Text>
        </Box>
      )
    case 'saved':
      return (
        <Box key="capture-saved" flexDirection="column">
          <Text bold color={COLORS.ecg}>
            Saved
          </Text>
          {capture.paths.map(path => noteLink(d, 'saved', path))}
          {buttonRow(d.t, 'capture-actions', [<Button key="capture" label="↻ Capture again" onPress={onCapture} />])}
        </Box>
      )
    case 'failed':
      return (
        <Box key="capture-failed" flexDirection="column">
          <Text bold color={COLORS.alarm}>
            Capture failed
          </Text>
          <Text color={COLORS.muted}>{capture.reason}</Text>
          {buttonRow(d.t, 'capture-actions', [<Button key="capture" label="↻ Try again" onPress={onCapture} />])}
        </Box>
      )
  }
}
