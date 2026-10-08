// The plugin's only module that touches the engine: every hook, every `$` call and every
// `$.state` atom lives here, because the engine follows `$` and the atoms within this file
// alone. Everything under ./features and ./ui is pure: values and callbacks in, trees out.

import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  EngineInterface,
  HookStream,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  RenderElement,
  RenderSurface,
  Timer,
  ToolCallInput,
  ToolCallResult,
  TurnStepInput,
  TurnStepResult,
  UiOpenResult,
} from 'claude-code'

import type {
  AdvisorPick,
  AdvisorResult,
  CaptureState,
  CompanionView,
  ContainerLogs,
  GatePhase,
  GitPanelForm,
  GitPanelGitHub,
  GitPanelGitHubRepo,
  GitPanelRepo,
  GitPanelSnapshot,
  GitPanelStep,
  HudPoint,
  HudRateLimit,
  LedgerDraft,
  LedgerEntry,
  LedgerTab,
  MainView,
  NoteRef,
  PlanReviewPlan,
  PlanReviewStatus,
  Process,
  RadarIdea,
  RadarScan,
  RadarTab,
  RequestRecord,
  ScribeAnswer,
  ScribeNote,
  ScribeQuestion,
  SearchResult,
  SideView,
  VaultView,
} from '../types'
import { addCaptureLine, appendDatedSection, captureLine, capturePreview, cleanAnswer, isAllowedNotePath, newDailyText, newNoteText } from './features/brain/notes'
import {
  GENERIC_CONVENTIONS,
  SCRIBE_MODEL,
  SCRIBE_NAME,
  SCRIBE_PROMPT,
  SCRIBE_TYPE,
  buildTranscript,
  draftPrompt as scribeDraftPrompt,
  finalPrompt,
  parseScribeAnswer,
} from './features/brain/scribe'
import { NOTE_FOLDERS, countCaptures, localDate, localTime, mergeHits, newestNotes } from './features/brain/vault'
import { brainPanel, brainPlain } from './features/brain/view'
import {
  absolutePath,
  BROWSER_SERVER,
  companionSection,
  companionUrl,
  USAGE as COMPANION_USAGE,
  csvTable,
  fileCard,
  htmlTitle,
  isScratchpadPath,
  isShownOnWrite,
  jsonBlock,
  markdownPage,
  outputKind,
  outputPage,
  serverArgv,
  showableExtension,
  slugify,
} from './features/companion/logic'
import { markdownTitle, renderMarkdown } from './features/companion/markdown'
import { companionPanel, companionPlain } from './features/companion/view'
import { describeCall, isLive, keepListed, nameOf } from './features/crew/logic'
import { crewPanel, crewPlain } from './features/crew/view'
import {
  EDIT_TOOLS,
  GATE_TOAST,
  GUARD_FAILED_REASON,
  denyReason,
  editedPath,
  isInside,
  isWritableWhileBrainstorming,
  phaseAskedBy,
  resolvePath,
} from './features/gate/logic'
import { gatePanel, gatePlain } from './features/gate/view'
import { GH_TIMEOUT_MS, LOCAL_TIMEOUT_MS, failureText, folderName, lines, parseAheadBehind, parseRemotes, stepArgv } from './features/git/git'
import type { RunOutcome, Step } from './features/git/git'
import { confirmationText, isForcePush, planFrom } from './features/git/plan'
import type { Plan } from './features/git/plan'
import { buildSteps, remoteDecision } from './features/git/steps'
import type { RemoteSetup } from './features/git/steps'
import { gitPanel, gitPlain } from './features/git/view'
import {
  REASON_UNAVAILABLE,
  appendToLedger,
  baseName,
  calendarDay,
  clip,
  clockTime,
  countLineChanges,
  countOccurrences,
  entrySummary,
  formatChange,
  isMentionedIn,
  ledgerLine,
  relativeTo,
  tidyCommitMessage,
  timelineHtml,
  toOneSentence,
} from './features/ledger/logic'
import type { LineChanges } from './features/ledger/logic'
import { REQUESTS_KEPT, costDelta, requestForTool, requestTokens } from './features/ledger/requests'
import { ledgerPanel, ledgerPlain } from './features/ledger/view'
import { EMPTY_SNAPSHOT, takeSample } from './features/mac/sample'
import { macPanel, macPlain } from './features/mac/view'
import { isSideView, splitColumns } from './features/nav/logic'
import { changesMessage, countSections, fileName, isPlanPath } from './features/plan/logic'
import { NO_PLAN, cardSummary, planCard, planPanel, planPlain } from './features/plan/view'
import {
  STORE_KEYS,
  buildScanPrompt,
  draftPrompt as radarDraftPrompt,
  extractSession,
  filterIdeas,
  parseIdeas,
  sortByKind,
  storedList,
  whyUnanswered,
} from './features/radar/logic'
import type { SessionDigest } from './features/radar/logic'
import {
  ADVISOR_STORE_KEYS,
  CATALOG_PATHS,
  WELL_KNOWN_REPOS,
  buildAdvisorPrompt,
  candidates,
  catalogName,
  catalogUrl,
  entryKey,
  githubRepoOf,
  installCommand,
  installedKeys,
  parseCatalog,
  parsePicks,
} from './features/radar/advisor'
import type { CatalogEntry } from './features/radar/advisor'
import { radarPanel, radarPlain } from './features/radar/view'
import { buildChannels } from './features/vitals/channels'
import { findLimit, isAlarmOn, parseCavemanMode, SILENCE_MS } from './features/vitals/readings'
import { TICKS_PER_DESKTOP_REDRAW, VITALS_TICK_MS, VITALS_TRACE_MODE } from './features/vitals/svg'
import { WINDOW_MS } from './features/vitals/trace'
import { vitalsPanel, vitalsPlain } from './features/vitals/view'
import type { Room, Vitals } from './features/vitals/view'
import { DEFAULT_CONFIG, expandHome, readConfig } from './config'
import { redactSecrets } from './redact'
import type { Config } from './config'
import { columns } from './ui/chrome'
import type { Kit } from './ui/chrome'

type Engine = EngineInterface
type DockView = Exclude<MainView, 'vitals'> | SideView

// ---- State --------------------------------------------------------------------
// Declared in ../types under PluginState['dotclaude'].

const mainViewState = atom({ plugin: 'dotclaude', key: 'mainView' } as const, 'vitals' as MainView)
const sideViewState = atom({ plugin: 'dotclaude', key: 'sideView' } as const, null as SideView | null)

const nowState = atom({ plugin: 'dotclaude', key: 'now' } as const, 0)
const desktopTickState = atom({ plugin: 'dotclaude', key: 'desktopTick' } as const, 0)
const headerState = atom({ plugin: 'dotclaude', key: 'header' } as const, {
  project: '',
  branch: null,
  isDirty: false,
  model: '',
  startedAt: 0,
})
const contextState = atom({ plugin: 'dotclaude', key: 'context' } as const, { percent: 0, tokens: 0, window: 0 })
const contextHistoryState = atom({ plugin: 'dotclaude', key: 'contextHistory' } as const, [])
const rateLimitsState = atom({ plugin: 'dotclaude', key: 'rateLimits' } as const, [])
const costUsdState = atom({ plugin: 'dotclaude', key: 'costUsd' } as const, null)
const lastCallState = atom({ plugin: 'dotclaude', key: 'lastCall' } as const, null)
const seriesState = atom({ plugin: 'dotclaude', key: 'series' } as const, { context: [], rate: [], cost: [] })
const callsState = atom({ plugin: 'dotclaude', key: 'calls' } as const, [])
const callCountState = atom({ plugin: 'dotclaude', key: 'callCount' } as const, 0)
const cavemanState = atom({ plugin: 'dotclaude', key: 'caveman' } as const, null)
const silencedUntilState = atom({ plugin: 'dotclaude', key: 'silencedUntil' } as const, 0)

const gatePhaseState = atom({ plugin: 'dotclaude', key: 'gatePhase' } as const, 'brainstorm' as GatePhase)

const planState = atom({ plugin: 'dotclaude', key: 'plan' } as const, null as PlanReviewPlan | null)
const planCommentState = atom({ plugin: 'dotclaude', key: 'planComment' } as const, '')
const planPartState = atom({ plugin: 'dotclaude', key: 'planPart' } as const, 0)

const ledgerEntriesState = atom({ plugin: 'dotclaude', key: 'ledgerEntries' } as const, [] as LedgerEntry[])
const ledgerDraftState = atom({ plugin: 'dotclaude', key: 'ledgerDraft' } as const, { status: 'idle' } as LedgerDraft)
const ledgerTabState = atom({ plugin: 'dotclaude', key: 'ledgerTab' } as const, 'edits' as LedgerTab)
const ledgerRequestsState = atom({ plugin: 'dotclaude', key: 'ledgerRequests' } as const, [] as RequestRecord[])
const ledgerRequestOpenState = atom({ plugin: 'dotclaude', key: 'ledgerRequestOpen' } as const, null as string | null)

const companionIsOpenState = atom({ plugin: 'dotclaude', key: 'companionIsOpen' } as const, false)
const companionTokenState = atom({ plugin: 'dotclaude', key: 'companionToken' } as const, '')

const macSnapshotState = atom({ plugin: 'dotclaude', key: 'macSnapshot' } as const, EMPTY_SNAPSHOT)
const macLogsState = atom({ plugin: 'dotclaude', key: 'macLogs' } as const, null as ContainerLogs | null)

const brainViewState = atom({ plugin: 'dotclaude', key: 'brainView' } as const, null as VaultView | null)
const brainSearchState = atom({ plugin: 'dotclaude', key: 'brainSearch' } as const, { query: '', hits: [] } as SearchResult)
const brainCaptureState = atom({ plugin: 'dotclaude', key: 'brainCapture' } as const, { phase: 'idle' } as CaptureState)

const radarStatusState = atom({ plugin: 'dotclaude', key: 'radarStatus' } as const, { isScanning: false, error: null })
const radarLastScanState = atom({ plugin: 'dotclaude', key: 'radarLastScan' } as const, null as RadarScan | null)
const radarLaterState = atom({ plugin: 'dotclaude', key: 'radarLater' } as const, [] as RadarIdea[])
const radarTabState = atom({ plugin: 'dotclaude', key: 'radarTab' } as const, 'ideas' as RadarTab)
const advisorStatusState = atom({ plugin: 'dotclaude', key: 'advisorStatus' } as const, { isScanning: false, error: null })
const advisorResultState = atom({ plugin: 'dotclaude', key: 'advisorResult' } as const, null as AdvisorResult | null)

const gitSnapshotState = atom({ plugin: 'dotclaude', key: 'gitSnapshot' } as const, { kind: 'loading' } as GitPanelSnapshot)
const gitFormState = atom({ plugin: 'dotclaude', key: 'gitForm' } as const, { message: '' } as GitPanelForm)
const gitLogState = atom({ plugin: 'dotclaude', key: 'gitLog' } as const, [] as GitPanelStep[])
const gitIsBusyState = atom({ plugin: 'dotclaude', key: 'gitIsBusy' } as const, false)

const crewSnapshotState = atom({ plugin: 'dotclaude', key: 'crewSnapshot' } as const, { agents: [] as AgentInfo[], polledAt: 0 })
const crewActivityState = atom({ plugin: 'dotclaude', key: 'crewActivity' } as const, {} as Record<string, string>)
const crewStartedAtState = atom({ plugin: 'dotclaude', key: 'crewStartedAt' } as const, {} as Record<string, number>)
const crewComposerState = atom({ plugin: 'dotclaude', key: 'crewComposer' } as const, null as { agentId: string; draft: string } | null)

// Timers are closures, so they cannot live in $.state; a reload drops them with the module
// and session.start starts the ones the open views need again.
let macSampler: Timer | undefined
let brainTicker: Timer | undefined
let crewPoller: Timer | undefined
// The companion server this session started; undefined when none runs or when another
// session's server is reused (that one is not ours to stop). The child dies with the
// module on a reload, and so does this handle.
let companionServer: ServerStream | undefined
// The ledger file has no append call, only read and write: chaining the writes
// keeps two whys that land together from overwriting each other's line.
let ledgerWrites: Promise<void> = Promise.resolve()

type ServerStream = HookStream<ProcessSpawnChunk, ProcessSpawnResult>

// ---- Hooks --------------------------------------------------------------------

// The plugin's options, read again on every load: a change in /config reloads the module.
let config: Config = DEFAULT_CONFIG

export const register: Register = (on, options) => {
  config = readConfig(options)

  // Each feature starts on its own: one that fails is logged and the others still start.
  on('session.start', async ($, e, next) => {
    await startFeature($, 'workspace', () => startWorkspace($))
    await startFeature($, 'vitals', () => startVitals($))
    await startFeature($, 'gate', () => startGate($))
    await startFeature($, 'plan review', () => startPlanReview($))
    await startFeature($, 'ledger', () => startLedger($))
    await startFeature($, 'companion', () => startCompanion($))
    await startFeature($, 'mac', () => startMac($))
    await startFeature($, 'brain', () => startBrain($))
    await startFeature($, 'radar', () => startRadar($))
    await startFeature($, 'git', () => startGit($))
    await startFeature($, 'crew', () => startCrew($))
    return next(e)
  })

  // Each feature starts on its own: one that fails is logged and the others still start.
  // -- Workspace

  on('command.run', { command: 'vitals' }, async $ => {
    const opened = await openWorkspace($)
    await showMain($, 'vitals')
    await resumeViews($)
    return { text: placed(opened, 'Workspace opened on the vitals.') }
  })

  on('ui.close', { id: WORKSPACE }, async ($, e, next) => {
    stopTimers(await read($, mainViewState))
    stopTimers(await read($, sideViewState))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: WORKSPACE }, async ($, e) => {
    const main = await read($, mainViewState)
    const side = await read($, sideViewState)
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      const { Box, Text } = $.ui.resolve(e)
      const shown = [...(await plainLines($, main)), ...(side === null ? [] : await plainLines($, side))]
      return (
        <Box flexDirection="column">
          {shown.map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )
    }
    const kit: Kit = e.surface === 'terminal' ? { surface: 'terminal', t: $.ui.resolve(e) } : { surface: 'desktop', t: $.ui.resolve(e) }
    const split = splitColumns(e.props.bodyColumns, side !== null)
    const mainTree = await drawMain($, kit, main, { columns: split.main, rows: e.props.scroll.bodyRows })
    const sideTree = side === null ? null : await drawSide($, kit, side, split.side)
    return columns(kit.t, split, mainTree, sideTree)
  })

  // Every tool call, registered ahead of the gate so a refused call still counts: the
  // vitals' heartbeat and the crew's "Now" before it runs, plan detection after. A failure
  // here must never block a call: the handler replays the call's own answer.
  on('tool.call', async ($, e, next) => {
    await observeCall($, e).catch(error => $.ui.log(`dotclaude: could not record the call: ${errorText(error)}`, { to: 'debug' }))
    const started = await $.clock.now()
    const requestId = await attachToRequest($, e).catch(error => {
      $.ui.log(`dotclaude: could not attach the call to its request: ${errorText(error)}`, { to: 'debug' })
      return undefined
    })
    const ran = await next(e)
    if (requestId !== undefined) {
      await finishRequestTool($, requestId, e.tool_use_id, ran, started).catch(error =>
        $.ui.log(`dotclaude: could not finish the call's record: ${errorText(error)}`, { to: 'debug' }),
      )
    }
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const found = await findPlan($, e, ran.result)
      if (found !== null) await recordPlan($, found)
    } catch (error) {
      $.ui.log(`Reading the plan failed: ${errorText(error)}`)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // -- Vitals

  on('session.measure', async ($, e, next) => {
    await recordMeasurement($, e, await $.clock.now())
    return next(e)
  })

  // Main loop only. The cost a request adds is read around it: the session's real total
  // just before and just after, never a price table.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const before = isMain ? await requestMark($) : null
    const result = yield* next(e)
    if (before !== null && result.usage !== null) {
      const usage = result.usage
      await update($, lastCallState, () => ({
        inputTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        outputTokens: usage.output_tokens,
      }))
      await recordRequest($, e, result, before).catch(error =>
        $.ui.log(`dotclaude: could not record the request: ${errorText(error)}`, { to: 'debug' }),
      )
    }
    return result
  })

  // -- Gate

  on('command.run', { command: 'gate' }, async ($, e) => ({ text: await runGateCommand($, e.args) }))

  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    if ((await read($, gatePhaseState)) === 'approved') return next(e)
    const path = editedPath(e)
    if (path !== undefined && (await isPlanInsideProject($, path))) return next(e)
    return { deny: denyReason(config.approvalWords) }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GUARD_FAILED_REASON }))

  on('prompt.submit', async ($, e, next) => {
    const asked = PERSON_ORIGINS.has(e.origin.kind) ? phaseAskedBy(e.text, config) : undefined
    if (asked !== undefined) await changePhase($, asked)
    return next(e)
  })

  // -- Plan review

  on('command.run', { command: 'plan-review' }, async $ => {
    const current = await read($, planState)
    if (current === null) return { text: NO_PLAN }
    const opened = await openView($, 'plan')
    return { text: placed(opened, `Plan review opened on ${current.name}.`) }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const current = await read($, planState)
    const isPlanRow = current !== null && current.toolUseId === e.props.tool_use_id
    if (!isPlanRow || e.props.isRunning || e.props.isErrored) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>Plan ready for your review: {cardSummary(current)}. Run /plan-review to open it.</Text>
    }
    const planPath = current.planPath
    return planCard($.ui.resolve(e), {
      plan: current,
      review: act($, 'Opening the plan', () => openView($, 'plan')),
      openInCompanion: act($, 'Opening in the companion', async () => {
        if (planPath !== null) $.ui.toast(await showFile($, planPath))
      }),
    })
  })

  // -- Ledger

  on('command.run', { command: 'ledger' }, async ($, e) => {
    if (e.args.trim() === 'commit-message') {
      const result = await draftCommitMessage($)
      return { text: result.status === 'ready' ? result.text : result.status === 'failed' ? result.reason : '' }
    }
    const opened = await openView($, 'ledger')
    return { text: placed(opened, 'Ledger opened.') }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    // replace_all changes every occurrence, so the file is read before it changes.
    const occurrences = e.replace_all ? Math.max(1, countOccurrences(await readIfPresent($, e.file_path), e.old_string)) : 1
    const ran = await next(e)
    if (!hasSucceeded(ran)) return ran
    const one = countLineChanges(e.old_string, e.new_string)
    const changed = { added: one.added * occurrences, removed: one.removed * occurrences }
    const snippet = `Replaced:\n${clip(e.old_string, SNIPPET_MAX)}\nWith:\n${clip(e.new_string, SNIPPET_MAX)}`
    await recordChange($, { id: e.tool_use_id, tool: 'Edit', path: e.file_path, lines: changed, snippet })
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before = await readIfPresent($, e.file_path)
    const ran = await next(e)
    if (!hasSucceeded(ran) || (ran.result as { staged?: boolean } | undefined)?.staged) return ran
    const changed = countLineChanges(before, e.content)
    const snippet = `New content:\n${clip(e.content, SNIPPET_MAX)}`
    await recordChange($, { id: e.tool_use_id, tool: 'Write', path: e.file_path, lines: changed, snippet })
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (!hasSucceeded(ran)) return ran
    const result = ran.result as { old_source?: string } | undefined
    const after = e.edit_mode === 'delete' ? '' : e.new_source
    const changed = countLineChanges(result?.old_source ?? '', after)
    const snippet = `Cell source:\n${clip(after, SNIPPET_MAX)}`
    await recordChange($, { id: e.tool_use_id, tool: 'NotebookEdit', path: e.notebook_path, lines: changed, snippet })
    return ran
  }).catch(($, e, next) => next(e))

  // -- Companion

  on('command.run', { command: 'companion' }, async ($, e) => {
    try {
      return { text: await runCompanionCommand($, e.args) }
    } catch (error) {
      return { text: `Companion: ${errorText(error)}` }
    }
  })

  // While the companion is open, what Claude hands the user and the new pages it writes
  // land there too, so nobody has to look for them in Finder. Never blocks the call.
  on('tool.call', { tool: 'SendUserFile' }, async ($, e, next) => {
    const ran = await next(e)
    if (!hasSucceeded(ran) || !(await read($, companionIsOpenState))) return ran
    const cwd = await $.session.cwd()
    for (const file of e.files) {
      const path = absolutePath(file, cwd)
      // Outside the project and scratchpad only the path is shown: the views folder is
      // served locally, so a file from elsewhere (or a link) is never copied into it.
      if (await isOutputLocation($, path)) await showOutput($, path)
      else await showPathOnly($, path)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const isNew = !(await $.fs.exists(e.file_path))
    const ran = await next(e)
    if (!hasSucceeded(ran) || !isNew || !isShownOnWrite(e.file_path)) return ran
    if (!(await read($, companionIsOpenState)) || !(await isOutputLocation($, e.file_path))) return ran
    await showOutput($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, companionIsOpenState))) return composed
    return { sections: [...composed.sections, companionSection(companionUrl(config.companionPort), await companionDir($))] }
  })

  on('session.end', async ($, e, next) => {
    if (await read($, companionIsOpenState)) {
      await stopServer()
      await update($, companionIsOpenState, () => false)
    }
    return next(e)
  })

  // -- Mac

  on('command.run', { command: 'mac' }, async $ => {
    const opened = await openView($, 'mac')
    return { text: placed(opened, 'Mac opened.') }
  })

  // -- Brain

  // The scribe is the plugin's own worker, never one the main model should delegate to.
  on('agent.offer', { agent: 'dotclaude:scribe' }, () => ({ isOffered: false }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) void onScribeTurn($, e.agentId, e.reason, e.answer)
    return next(e)
  })

  on('command.run', { command: 'brain' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb !== '' && verb !== 'capture') return { text: BRAIN_USAGE }
    let opened: UiOpenResult
    try {
      opened = await openView($, 'brain')
    } catch (error) {
      return { text: `Could not read the vault: ${errorText(error)}` }
    }
    if (verb === '') return { text: placed(opened, 'Second brain opened.') }
    void startCapture($, rest.join(' '))
    return { text: 'The scribe is reading the session.' }
  })

  // -- Radar

  on('command.run', { command: 'radar' }, async $ => {
    const opened = await openView($, 'radar')
    return { text: placed(opened, 'Radar opened.') }
  })

  // -- Git

  on('command.run', { command: 'git-panel' }, async $ => {
    const opened = await openView($, 'git')
    return { text: placed(opened, 'Git opened.') }
  })

  // -- Crew

  on('command.run', { command: 'crew' }, async $ => {
    const opened = await openView($, 'crew')
    return { text: placed(opened, 'Crew opened.') }
  })

  // Spawn time makes "elapsed" true even when the view opens long after the agent started.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId !== undefined) {
      const agentId = spawned.agentId
      const now = await $.clock.now()
      await update($, crewStartedAtState, known => ({ ...known, [agentId]: now }))
    }
    return spawned
  })
}

// ---- Session start ------------------------------------------------------------

async function startFeature($: Engine, feature: string, start: () => Promise<void>): Promise<void> {
  try {
    await start()
  } catch (error) {
    $.ui.log(`dotclaude: ${feature} did not start: ${errorText(error)}`)
  }
}

async function startWorkspace($: Engine): Promise<void> {
  await $.command.register({ name: 'vitals', description: 'Open the workspace on the vitals rail' })
  // After a hot reload the pane may still be up while the timers its views need are gone.
  if (await isWorkspaceOpen($)) await resumeViews($)
  void $.ui.open({ id: WORKSPACE, title: WORKSPACE_TITLE })
}

async function startVitals($: Engine): Promise<void> {
  vitalsPaths = await readPaths($)
  const usage = await $.session.usage()
  await update($, headerState, header => ({ ...header, startedAt: usage.startedAt }))
  await recordMeasurement($, usage, await $.clock.now())
  await refreshVitals($, true, true)
  startTicking($)
}

async function startGate($: Engine): Promise<void> {
  await $.command.register({
    name: 'gate',
    description: 'Show the brainstorm gate, or change it with approve or lock',
    argumentHint: '[approve|lock]',
  })
}

async function startPlanReview($: Engine): Promise<void> {
  await $.command.register({ name: 'plan-review', description: 'Open the latest plan for review' })
}

async function startLedger($: Engine): Promise<void> {
  await $.command.register({
    name: 'ledger',
    description: 'Show what was changed this session and why',
    argumentHint: '[commit-message]',
  })
}

async function startCompanion($: Engine): Promise<void> {
  await $.command.register({
    name: 'companion',
    description: 'Open the companion view in the browser pane',
    argumentHint: '[show <absolute path>]',
  })
  await reviveIfStale($).catch(error => $.ui.toast(`Companion: ${errorText(error)}`))
}

async function startMac($: Engine): Promise<void> {
  await $.command.register({ name: 'mac', description: 'Show CPU, memory, disk, battery, processes and Docker' })
}

async function startBrain($: Engine): Promise<void> {
  await $.command.register({
    name: 'brain',
    description: 'Open your notes vault, or capture this session into it',
    argumentHint: '[capture [text]]',
  })
  await $.agent.register({
    name: SCRIBE_NAME,
    description: 'Extracts what is worth keeping from a session for your notes vault',
    prompt: SCRIBE_PROMPT,
    tools: [],
    model: SCRIBE_MODEL,
    omitClaudeMd: true,
  })
}

async function startRadar($: Engine): Promise<void> {
  await $.command.register({ name: 'radar', description: 'Suggests skills, mods and agents from your recent work' })
}

async function startGit($: Engine): Promise<void> {
  await $.command.register({ name: 'git-panel', description: 'Open the Git panel: status, commit and push' })
}

async function startCrew($: Engine): Promise<void> {
  await $.command.register({ name: 'crew', description: "Show the session's agents: why each runs, what it does now" })
}

/** The vitals' heartbeat (main loop only, as statusline.sh counts) and the crew's "Now" (subagents). */
async function observeCall($: Engine, e: ToolCallInput): Promise<void> {
  const agentId = e.agentId
  if (agentId === undefined) {
    await recordCall($, await $.clock.now())
    return
  }
  const line = describeCall(String(e.tool), e as Readonly<Record<string, unknown>>, await $.session.cwd())
  await update($, crewActivityState, known => ({ ...known, [agentId]: line }))
}

// ---- Shared helpers -----------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A press handler: runs the work unawaited, and turns a failure into a toast instead of a silent drop. */
function act($: Engine, what: string, work: () => Promise<unknown>): () => void {
  return () => void work().catch(error => $.ui.toast(`${what} failed: ${errorText(error)}`))
}

function placed(opened: UiOpenResult, text: string): string {
  return opened.isPlaced ? text : `The workspace waits: ${opened.reason}`
}

/** True only when the person picks `action`; another answer or a dismissed dialog says no. */
async function confirm($: Engine, question: string, action: string, header: string): Promise<boolean> {
  try {
    return (await $.ui.ask(question, { options: [action, 'Cancel'], header })) === action
  } catch {
    // ask rejects when the dialog is dismissed or nobody can answer: that is a no.
    return false
  }
}

async function readIfPresent($: Engine, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
}

async function homeDir($: Engine): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set, so the plugin cannot find your files')
  return home
}

/** Claude Code's own folder: CLAUDE_CONFIG_DIR when set, else ~/.claude. */
async function claudeDir($: Engine): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

// ---- Workspace and navigation -------------------------------------------------

const WORKSPACE = 'workspace'
const WORKSPACE_TITLE = 'Workspace'

function openWorkspace($: Engine): Promise<UiOpenResult> {
  return $.ui.open({ id: WORKSPACE, title: WORKSPACE_TITLE })
}

async function isWorkspaceOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === WORKSPACE)
}

/** A command's shortcut: the workspace, open on that view. */
async function openView($: Engine, view: DockView): Promise<UiOpenResult> {
  const opened = await openWorkspace($)
  await showView($, view)
  await resumeViews($)
  return opened
}

function showView($: Engine, view: DockView): Promise<void> {
  return isSideView(view) ? showSide($, view) : showMain($, view)
}

/** Puts a view in the main column; the vitals rail is the main column's resting view. */
async function showMain($: Engine, view: MainView): Promise<void> {
  const previous = await read($, mainViewState)
  if (previous === view) return
  stopTimers(previous)
  await update($, mainViewState, () => view)
  await loadView($, view)
  startTimers($, view)
}

/** Opens a side panel beside the main column, in place of the one open; null closes it. */
async function showSide($: Engine, view: SideView | null): Promise<void> {
  const previous = await read($, sideViewState)
  if (previous === view) return
  stopTimers(previous)
  await update($, sideViewState, () => view)
  await loadView($, view)
  startTimers($, view)
}

/** What a view reads once as it opens. */
async function loadView($: Engine, view: MainView | SideView | null): Promise<void> {
  if (view === 'brain') await refreshVault($)
  if (view === 'radar') await loadRadarFromStore($)
  if (view === 'radar') await loadAdvisorFromStore($)
  if (view === 'crew') await refreshCrew($)
  // A timer runs outside the press's or command's dispatch, so the slow git reads never hold it up.
  if (view === 'git') $.clock.after(0, () => void refreshGit($))
}

/** The polling a view does while it shows; each start is a no-op when already running. */
function startTimers($: Engine, view: MainView | SideView | null): void {
  if (view === 'mac') startSampling($)
  if (view === 'brain') startBrainTicker($)
  if (view === 'crew') startCrewPolling($)
}

function stopTimers(view: MainView | SideView | null): void {
  if (view === 'mac') stopSampling()
  if (view === 'brain') stopBrainTicker()
  if (view === 'crew') stopCrewPolling()
}

async function resumeViews($: Engine): Promise<void> {
  startTimers($, await read($, mainViewState))
  startTimers($, await read($, sideViewState))
}

async function drawMain($: Engine, kit: Kit, view: MainView, room: Room): Promise<RenderElement> {
  const close = act($, 'Closing', () => showMain($, 'vitals'))
  switch (view) {
    case 'vitals':
      return vitalsPanel(kit, await readVitals($, kit.surface), room)
    case 'ledger': {
      // Only the shown tab's values are read, so a busy turn does not redraw the Edits tab.
      const tab = await read($, ledgerTabState)
      const isEdits = tab === 'edits'
      return ledgerPanel(
        kit,
        {
          tab,
          selectTab: next => void update($, ledgerTabState, () => next),
          edits: {
            entries: isEdits ? await read($, ledgerEntriesState) : [],
            draft: isEdits ? await read($, ledgerDraftState) : { status: 'idle' },
            startDraft: act($, 'Drafting', () => startDraft($)),
            copyDraft: press => void copyDraft($, press.surface).catch(error => $.ui.toast(`Copy failed: ${errorText(error)}`)),
            saveToBrain: act($, 'Saving to brain', () => saveToBrain($)),
            showTimeline: act($, 'Timeline', () => showTimeline($)),
          },
          requests: {
            requests: isEdits ? [] : await read($, ledgerRequestsState),
            openId: isEdits ? null : await read($, ledgerRequestOpenState),
            sessionCostUsd: isEdits ? null : await read($, costUsdState),
            open: id => void update($, ledgerRequestOpenState, () => id),
            back: () => void update($, ledgerRequestOpenState, () => null),
          },
          close,
        },
        room.columns,
      )
    }
    case 'companion':
      return companionPanel(
        kit,
        {
          isOpen: await read($, companionIsOpenState),
          url: companionUrl(config.companionPort),
          open: act($, 'Opening the companion', async () => $.ui.toast(await ensureCompanion($))),
          stop: act($, 'Closing the companion', () => closeCompanion($)),
          close,
        },
        room.columns,
      )
    case 'git':
      return gitPanel(
        kit,
        {
          snapshot: await read($, gitSnapshotState),
          form: await read($, gitFormState),
          log: await read($, gitLogState),
          isBusy: await read($, gitIsBusyState),
          setForm: change => void setGitForm($, change),
          checkNewBranch: name => void checkNewBranch($, name),
          push: act($, 'Pushing', () => pushFromPane($)),
          refresh: act($, 'Refreshing', () => refreshGit($)),
          init: cwd => act($, 'Initializing', () => initRepository($, cwd))(),
          close,
        },
        room.columns,
      )
    case 'crew': {
      const { agents, polledAt } = await read($, crewSnapshotState)
      return crewPanel(
        kit,
        {
          agents,
          polledAt,
          activity: await read($, crewActivityState),
          startedAt: await read($, crewStartedAtState),
          composer: await read($, crewComposerState),
          stop: agent => act($, 'Stopping', () => stopAgent($, agent))(),
          toggleComposer: agentId => void toggleComposer($, agentId),
          keepDraft: (agentId, draft) => void keepDraft($, agentId, draft),
          send: (agent, text) => act($, 'Sending', () => sendMessage($, agent, text))(),
          sendDraft: agent => act($, 'Sending', () => sendDraft($, agent))(),
          close,
        },
        room.columns,
      )
    }
  }
}

async function drawSide($: Engine, kit: Kit, view: SideView, columnCount: number): Promise<RenderElement> {
  const close = act($, 'Closing', () => showSide($, null))
  switch (view) {
    case 'gate':
      return gatePanel(
        kit,
        {
          phase: await read($, gatePhaseState),
          approve: act($, 'Approving', () => changePhase($, 'approved')),
          relock: act($, 'Locking', () => changePhase($, 'brainstorm')),
          close,
        },
        columnCount,
      )
    case 'plan':
      return planPanel(
        kit,
        {
          plan: await read($, planState),
          comment: await read($, planCommentState),
          part: await read($, planPartState),
          approve: act($, 'Approving the plan', () => approvePlan($)),
          requestChanges: act($, 'Requesting changes', () => requestChanges($)),
          keepComment: text => void update($, planCommentState, () => text),
          showPart: part => void update($, planPartState, () => part),
          close,
        },
        columnCount,
      )
    case 'mac':
      return macPanel(
        kit,
        {
          snapshot: await read($, macSnapshotState),
          logs: await read($, macLogsState),
          endProcess: process => void endProcess($, process),
          stopContainer: name => void stopContainer($, name),
          showLogs: name => void showLogs($, name),
          hideLogs: () => void update($, macLogsState, () => null),
          close,
        },
        columnCount,
      )
    case 'brain':
      return brainPanel(
        kit,
        {
          view: await read($, brainViewState),
          search: await read($, brainSearchState),
          capture: await read($, brainCaptureState),
          nowMs: await $.clock.now(),
          runSearch: query => act($, 'Search', () => runSearch($, query))(),
          openNote: url => act($, 'Opening the note', () => openNote($, url))(),
          startCapture: act($, 'Capture', () => startCapture($, '')),
          close,
        },
        columnCount,
      )
    case 'radar':
      return radarPanel(
        kit,
        {
          tab: await read($, radarTabState),
          selectTab: next => void update($, radarTabState, () => next),
          ideas: {
            status: await read($, radarStatusState),
            lastScan: await read($, radarLastScanState),
            later: await read($, radarLaterState),
            scan: act($, 'Scan', () => scanNow($)),
            draft: idea => act($, 'Draft', () => draftIdea($, idea))(),
            keepForLater: idea => act($, 'Later', () => keepForLater($, idea))(),
            dismiss: idea => act($, 'Dismiss', () => dismissIdea($, idea))(),
          },
          advisor: {
            status: await read($, advisorStatusState),
            result: await read($, advisorResultState),
            scan: act($, 'Scan', () => scanAdvisor($)),
            copyInstall: (pick, press) => act($, 'Copy', () => copyInstall($, pick, press.surface))(),
            hide: pick => act($, 'Hide', () => hideAdvisorPick($, pick))(),
          },
          close,
        },
        columnCount,
      )
  }
}

/** vscode and mobile: each view's facts as plain lines, no controls. */
async function plainLines($: Engine, view: MainView | SideView): Promise<string[]> {
  switch (view) {
    case 'vitals':
      return vitalsPlain(await readVitals($, 'plain'))
    case 'ledger':
      return ledgerPlain(await read($, ledgerEntriesState))
    case 'companion':
      return companionPlain(await read($, companionIsOpenState), companionUrl(config.companionPort))
    case 'git':
      return gitPlain(await read($, gitSnapshotState))
    case 'crew': {
      const { agents, polledAt } = await read($, crewSnapshotState)
      return crewPlain({
        agents,
        polledAt,
        activity: await read($, crewActivityState),
        startedAt: await read($, crewStartedAtState),
        composer: await read($, crewComposerState),
      })
    }
    case 'gate':
      return gatePlain(await read($, gatePhaseState))
    case 'plan':
      return planPlain(await read($, planState))
    case 'mac':
      return macPlain(await read($, macSnapshotState))
    case 'brain':
      return brainPlain(await read($, brainViewState), await read($, brainCaptureState))
    case 'radar':
      return radarPlain(await read($, radarLastScanState))
  }
}

// ---- Vitals -------------------------------------------------------------------

type Measurement = {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: readonly HudRateLimit[]
  cost?: { usd: number }
}

type Paths = { root: string; home: string; configDir: string }

// git, the model and the project change rarely; files are cheap enough to read every tick.
const SLOW_REFRESH_MS = 5000
// A beat lasts a second, so a call just outside the window still draws its tail.
const KEEP_CALLS_MS = WINDOW_MS + 1000

let vitalsPaths: Paths = { root: '', home: '', configDir: '' }

async function readPaths($: Engine): Promise<Paths> {
  return {
    root: await $.session.root(),
    home: await homeDir($),
    // the caveman flag lives in Claude Code's own folder, as statusline.sh reads it
    configDir: await claudeDir($),
  }
}

function startTicking($: Engine): void {
  let ticks = 0
  const slowEvery = Math.round(SLOW_REFRESH_MS / VITALS_TICK_MS)
  $.clock.every(VITALS_TICK_MS, () => {
    ticks += 1
    void tick($, ticks % slowEvery === 0, ticks % TICKS_PER_DESKTOP_REDRAW === 0)
  })
}

async function tick($: Engine, isSlow: boolean, isDesktopTick: boolean): Promise<void> {
  try {
    await refreshVitals($, isSlow, isDesktopTick)
  } catch (error) {
    $.ui.log(`dotclaude: vitals tick failed: ${errorText(error)}`, { to: 'debug' })
  }
}

// Each drawing redraws when a value it read is written, so a write that changes nothing is skipped.
async function refreshVitals($: Engine, isSlow: boolean, isDesktopTick: boolean): Promise<void> {
  const now = await $.clock.now()
  await update($, nowState, () => now)
  if (isDesktopTick) await update($, desktopTickState, () => now)
  const caveman = await readCaveman($)
  if (caveman !== (await read($, cavemanState))) await update($, cavemanState, () => caveman)
  if (!isSlow) return
  const git = await readGitHead($, vitalsPaths.root)
  const model = await $.session.model()
  const project = vitalsPaths.root.split('/').filter(part => part !== '').pop() ?? vitalsPaths.root
  const header = await read($, headerState)
  const isSame = header.branch === git.branch && header.isDirty === git.isDirty && header.model === model && header.project === project
  if (!isSame) await update($, headerState, current => ({ ...current, ...git, model, project }))
}

async function recordMeasurement($: Engine, measured: Measurement, at: number): Promise<void> {
  const percent = measured.context.percent ?? 0
  const rateLimits = measured.rateLimits.map(limit => ({ ...limit }))
  const fiveHour = findLimit(rateLimits, 'five_hour')
  const costUsd = measured.cost?.usd ?? null
  await update($, contextState, () => ({
    percent,
    tokens: measured.context.tokens ?? 0,
    window: measured.context.window,
  }))
  await update($, contextHistoryState, history => [...history, percent].slice(-6))
  await update($, rateLimitsState, () => rateLimits)
  await update($, costUsdState, () => costUsd)
  await update($, seriesState, series => ({
    context: addPoint(series.context, at, percent / 100),
    rate: fiveHour === undefined ? series.rate : addPoint(series.rate, at, fiveHour.percentUsed / 100),
    cost: costUsd === null ? series.cost : addPoint(series.cost, at, costUsd),
  }))
}

/** Appends a reading, keeping the last one before the window: it sets the trace's left edge. */
function addPoint(points: readonly HudPoint[], at: number, value: number): HudPoint[] {
  const all = [...points, { at, value }]
  const firstInside = all.findIndex(point => point.at >= at - WINDOW_MS)
  return all.slice(Math.max(0, firstInside - 1))
}

async function recordCall($: Engine, at: number): Promise<void> {
  await update($, callsState, calls => [...calls.filter(call => call >= at - KEEP_CALLS_MS), at])
  await update($, callCountState, count => count + 1)
}

/**
 * The terminal's braille sweep moves with each 1 s tick, so it reads that tick. The desktop's
 * SVG sweeps itself, so its drawing reads only the slow tick (and the data) and takes the
 * time from the clock: every redraw starts the sweep exactly where it stands.
 */
async function readVitals($: Engine, surface: RenderSurface | 'plain'): Promise<Vitals> {
  const isSelfAnimated = surface === 'desktop' && VITALS_TRACE_MODE === 'smil'
  const now = isSelfAnimated ? await readDesktopClock($) : await read($, nowState)
  const context = await read($, contextState)
  const silencedUntil = await read($, silencedUntilState)
  return {
    now,
    header: await read($, headerState),
    contextPercent: context.percent,
    gatePhase: await read($, gatePhaseState),
    isCompanionOpen: await read($, companionIsOpenState),
    caveman: await read($, cavemanState),
    isAlarm: isAlarmOn(context.percent, now, silencedUntil),
    channels: buildChannels({
      now,
      context,
      contextHistory: await read($, contextHistoryState),
      rateLimits: await read($, rateLimitsState),
      costUsd: await read($, costUsdState),
      lastCall: await read($, lastCallState),
      series: await read($, seriesState),
      calls: await read($, callsState),
      callCount: await read($, callCountState),
    }),
    actions: {
      open: view => act($, 'Opening', () => showView($, view))(),
      compact: act($, 'Compacting', () => compactAfterAsking($)),
      silence: act($, 'Silencing', () => silence($)),
    },
  }
}

/** The clock, read by a drawing that redraws on the slow tick only. */
async function readDesktopClock($: Engine): Promise<number> {
  await read($, desktopTickState)
  return $.clock.now()
}

// Compaction rewrites the conversation for good, so it asks first, as the plugin's rules say.
async function compactAfterAsking($: Engine): Promise<void> {
  const answer = await $.ui.ask('Compact the conversation now?', ['Compact', 'Cancel']).catch(() => 'Cancel')
  if (answer !== 'Compact') return
  try {
    const { skip } = await $.session.compact()
    if (skip) $.ui.toast('Another plugin kept the conversation from compacting.')
  } catch (error) {
    $.ui.toast(`Compaction waits for the turn to end: ${errorText(error)}`)
  }
}

async function silence($: Engine): Promise<void> {
  const now = await $.clock.now()
  await update($, silencedUntilState, () => now + SILENCE_MS)
  $.ui.toast('Alarm silenced for 10 min')
}

/** Branch and dirty state as statusline.sh reads them; no branch outside a repository. */
async function readGitHead($: Engine, cwd: string): Promise<{ branch: string | null; isDirty: boolean }> {
  const head = await $.process
    .run(withoutFsmonitor(['git', '-C', cwd, '--no-optional-locks', 'symbolic-ref', '--short', 'HEAD']))
    .catch(() => undefined)
  if (head === undefined || head.exitCode !== 0) return { branch: null, isDirty: false }
  const status = await $.process
    .run(withoutFsmonitor(['git', '-C', cwd, '--no-optional-locks', 'status', '--porcelain']))
    .catch(() => undefined)
  return { branch: head.stdout.trim(), isDirty: (status?.stdout.trim() ?? '') !== '' }
}

async function readCaveman($: Engine): Promise<string | null> {
  const text = await readPlainFile($, `${vitalsPaths.configDir}/.caveman-active`)
  return text === null ? null : parseCavemanMode(text)
}

/** A regular file's text; null when missing or a symbolic link, as statusline.sh skips those. */
async function readPlainFile($: Engine, path: string): Promise<string | null> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined || stat.isLink || stat.kind !== 'file') return null
  return await $.fs.read(path)
}

// ---- Gate ---------------------------------------------------------------------

// Approval must come from the person: their prompt, Remote Control, or the SDK host (desktop).
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

/**
 * A path's real location, every link resolved: its own real path when it exists, else its
 * nearest existing parent's real path with the rest appended (a file about to be created).
 */
async function realPathOf($: Engine, path: string): Promise<string> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (stat?.realPath !== undefined) return stat.realPath
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return path
  const parent = await realPathOf($, path.slice(0, cut))
  return `${parent === '/' ? '' : parent}/${path.slice(cut + 1)}`
}

/**
 * Whether an edit may go ahead while brainstorming: a plan or spec path, resolved, inside the
 * project. A target that is itself a symbolic link, even one leading nowhere yet, is refused:
 * the write would land wherever it points.
 */
async function isPlanInsideProject($: Engine, path: string): Promise<boolean> {
  const absolute = resolvePath(path, await $.session.cwd())
  const target = await $.fs.stat(absolute).catch(() => undefined)
  if (target?.isLink) return false
  const root = await realPathOf($, await $.session.root())
  const resolved = await realPathOf($, absolute)
  if (resolved === root || !isInside(resolved, root)) return false
  return isWritableWhileBrainstorming(relativeTo(root, resolved))
}

/** Sets the phase; true when it changed. */
async function setPhase($: Engine, next: GatePhase): Promise<boolean> {
  if ((await read($, gatePhaseState)) === next) return false
  await update($, gatePhaseState, () => next)
  return true
}

async function changePhase($: Engine, next: GatePhase): Promise<void> {
  if (await setPhase($, next)) $.ui.toast(GATE_TOAST[next])
}

async function runGateCommand($: Engine, args: string): Promise<string> {
  const verb = args.trim()
  if (verb === 'approve') {
    await changePhase($, 'approved')
    return GATE_TOAST.approved
  }
  if (verb === 'lock') {
    await changePhase($, 'brainstorm')
    return GATE_TOAST.brainstorm
  }
  if (verb !== '') return `Unknown argument "${verb}". Use /gate, /gate approve or /gate lock.`
  return placed(await openView($, 'gate'), 'Gate opened.')
}

// ---- Plan review --------------------------------------------------------------

async function recordPlan($: Engine, found: PlanReviewPlan): Promise<void> {
  await update($, planState, () => found)
  await update($, planPartState, () => 0)
  await update($, planCommentState, () => '')
}

function setPlanStatus($: Engine, status: PlanReviewStatus): Promise<PlanReviewPlan | null> {
  return update($, planState, current => (current === null ? null : { ...current, status }))
}

/** Approving the plan unlocks edits: the gate's own phase, set directly. */
async function approvePlan($: Engine): Promise<void> {
  if ((await setPlanStatus($, 'approved')) === null) return
  await setPhase($, 'approved')
  $.ui.toast('Plan approved, edits unlocked')
}

async function requestChanges($: Engine): Promise<void> {
  const current = await setPlanStatus($, 'changes')
  if (current === null) return
  const text = changesMessage(current.name, await read($, planCommentState))
  // Not awaited: a prompt starts its turn once the session is idle, and the press must not wait on it.
  void $.prompt.submit({ text }).catch(error => $.ui.log(`Sending the comment failed: ${errorText(error)}`))
  await update($, planCommentState, () => '')
  $.ui.toast('Comment sent to Claude')
}

function newPlan(toolUseId: string, planPath: string | null, text: string): PlanReviewPlan {
  return {
    planPath,
    status: 'pending',
    name: planPath === null ? 'the plan-mode plan' : fileName(planPath),
    text,
    sections: countSections(text),
    toolUseId,
  }
}

// ExitPlanMode's input carries no plan: its result reports the plan it showed and, when saved, where.
async function planFromPlanMode($: Engine, toolUseId: string, result: unknown): Promise<PlanReviewPlan | null> {
  const { plan: text, filePath } = (result ?? {}) as { plan?: string | null; filePath?: string }
  if (typeof text === 'string') return newPlan(toolUseId, filePath ?? null, text)
  if (typeof filePath === 'string') return newPlan(toolUseId, filePath, await $.fs.read(filePath))
  return null
}

// The file is read back after the call so an Edit, or a Write the person changed in the
// dialog, is reviewed as it stands on disk.
async function findPlan($: Engine, e: ToolCallInput, result: unknown): Promise<PlanReviewPlan | null> {
  if (e.tool === 'ExitPlanMode') return planFromPlanMode($, e.tool_use_id, result)
  if (e.tool !== 'Write' && e.tool !== 'Edit') return null
  if (!isPlanPath(e.file_path) || !(await isProjectFile($, e.file_path))) return null
  return newPlan(e.tool_use_id, e.file_path, await $.fs.read(e.file_path))
}

/** A regular file of the project: no symbolic link, and its real path inside the session root. */
async function isProjectFile($: Engine, path: string): Promise<boolean> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat?.isLink) return false
  const root = await realPathOf($, await $.session.root())
  return isInside(await realPathOf($, path), root)
}

// ---- Ledger -------------------------------------------------------------------

const LEDGER_MODEL = 'haiku'
const SNIPPET_MAX = 1500
const MESSAGE_MAX = 4000

const WHY_SYSTEM =
  "You keep a change ledger for a software project. Given the assistant's latest message and a code change, " +
  'say why the change was made in one plain sentence, past tense, at most 20 words. Reply with the sentence only.'

const COMMIT_SYSTEM =
  'You write git commit messages. First line: a subject in the imperative mood, at most 72 characters, ' +
  'no trailing period. Then a blank line and a short body, wrapped at 72 characters, explaining why the change ' +
  'was made rather than listing files. Reply with the commit message only, no code fences.'

/** One successful change as the tool hooks see it, before it becomes an entry. */
type Change = { id: string; tool: string; path: string; lines: LineChanges; snippet: string }

const hasSucceeded = (ran: { deny?: string; isError?: true }) => ran.deny === undefined && ran.isError !== true

/** True when an approved plan exists and mentions the file neither by path nor by name. */
async function isOutsideApprovedPlan($: Engine, file: string): Promise<boolean> {
  const plan = await read($, planState)
  if (plan === null || plan.status !== 'approved' || plan.planPath === null) return false
  return plan.text !== '' && !isMentionedIn(plan.text, file)
}

async function lastAssistantText($: Engine): Promise<string> {
  const messages = await $.session.messages()
  if ('deny' in messages) return ''
  return messages.findLast(message => message.role === 'assistant' && message.text.trim() !== '')?.text ?? ''
}

async function askWhy($: Engine, entry: LedgerEntry, tool: string, snippet: string): Promise<string> {
  const message = clip(await lastAssistantText($), MESSAGE_MAX)
  const prompt = `Assistant's latest message:\n${message || '(none)'}\n\n` + `Change: ${tool} ${entry.file} ${formatChange(entry)}\n${snippet}`
  const reply = await $.model.complete({ model: LEDGER_MODEL, system: WHY_SYSTEM, prompt: redactSecrets(prompt), maxTokens: 120 })
  return reply.isAnswered ? toOneSentence(reply.text) : REASON_UNAVAILABLE
}

function appendLedgerLine($: Engine, root: string, day: string, line: string): Promise<void> {
  const path = `${root}/.claude/ledger.md`
  ledgerWrites = ledgerWrites
    .then(async () => $.fs.write(path, appendToLedger(await readIfPresent($, path), day, line)))
    .catch(error => $.ui.toast(`Ledger could not write .claude/ledger.md: ${errorText(error)}`))
  return ledgerWrites
}

async function explain($: Engine, entry: LedgerEntry, change: Change, root: string, day: string): Promise<void> {
  const why = await askWhy($, entry, change.tool, change.snippet).catch(() => REASON_UNAVAILABLE)
  await update($, ledgerEntriesState, list => list.map(one => (one.id === entry.id ? { ...one, why } : one)))
  await appendLedgerLine($, root, day, ledgerLine({ ...entry, why }))
}

async function recordChange($: Engine, change: Change): Promise<void> {
  const root = await $.session.root()
  const now = await $.clock.now()
  const file = relativeTo(root, change.path)
  const entry: LedgerEntry = {
    id: change.id,
    time: clockTime(now),
    file,
    ...change.lines,
    why: null,
    isOutsidePlan: await isOutsideApprovedPlan($, file),
  }
  await update($, ledgerEntriesState, list => [...list, entry])
  // The why waits on a model call; a timer runs it after the tool result has gone back,
  // so the call is never held up by it.
  $.clock.after(0, () => void explain($, entry, change, root, calendarDay(now)))
}

async function draftCommitMessage($: Engine): Promise<LedgerDraft> {
  const list = await read($, ledgerEntriesState)
  if (list.length === 0) return { status: 'failed', reason: 'No ledger entries in this session yet.' }
  const prompt = `Ledger entries for this change:\n${list.map(entry => `- ${entrySummary(entry)}`).join('\n')}`
  const reply = await $.model.complete({ model: LEDGER_MODEL, system: COMMIT_SYSTEM, prompt: redactSecrets(prompt), maxTokens: 400 })
  if (!reply.isAnswered) return { status: 'failed', reason: `Could not draft a commit message (${reply.reason}).` }
  return { status: 'ready', text: tidyCommitMessage(reply.text) }
}

async function startDraft($: Engine): Promise<void> {
  await update($, ledgerDraftState, () => ({ status: 'drafting' }))
  const result = await draftCommitMessage($).catch(error => ({ status: 'failed', reason: errorText(error) }) as LedgerDraft)
  await update($, ledgerDraftState, () => result)
}

async function copyDraft($: Engine, surface: RenderSurface): Promise<void> {
  const current = await read($, ledgerDraftState)
  if (current.status !== 'ready') return
  const copied = await $.ui.copy({ text: current.text, surface })
  $.ui.toast(copied.isCopied ? 'Commit message copied.' : 'Could not copy the commit message.')
}

/** Hands the session's entries to the brain's scribe, with the brain panel open beside. */
async function saveToBrain($: Engine): Promise<void> {
  const list = await read($, ledgerEntriesState)
  const summary = `Ledger: ${list.map(entrySummary).join('; ')}`
  await showSide($, 'brain')
  await startCapture($, clip(summary, 2000))
}

/** The session's changes as a timeline view, written straight into the companion's folder. */
async function showTimeline($: Engine): Promise<void> {
  const root = await $.session.root()
  const html = timelineHtml(baseName(root), await read($, ledgerEntriesState))
  $.ui.toast(await addView($, 'ledger-timeline', 'Ledger timeline', html))
}

// ---- Ledger requests ----------------------------------------------------------

/** When a request started and what the session had cost by then; null where no cost ledger is kept. */
type RequestMark = { at: number; costUsd: number | null }

async function requestMark($: Engine): Promise<RequestMark> {
  const at = await $.clock.now()
  const usage = await $.session.usage().catch(() => undefined)
  return { at, costUsd: usage?.cost?.usd ?? null }
}

async function recordRequest($: Engine, e: TurnStepInput, result: TurnStepResult, before: RequestMark): Promise<void> {
  if (result.usage === null) return
  const after = await requestMark($)
  const record: RequestRecord = {
    id: `${e.turnId}:${e.index}`,
    turnId: e.turnId,
    index: e.index,
    at: before.at,
    model: result.usage.model,
    tokens: requestTokens(result.usage),
    costUsd: costDelta(before.costUsd, after.costUsd),
    durationMs: after.at - before.at,
    expectedTools: result.toolUses.map(use => use.name),
    tools: [],
  }
  await update($, ledgerRequestsState, list => [...list, record].slice(-REQUESTS_KEPT))
}

/** Adds a main-loop tool call to the request that asked for it; that request's id, if any. */
async function attachToRequest($: Engine, e: ToolCallInput): Promise<string | undefined> {
  if (e.agentId !== undefined) return undefined
  const tool = String(e.tool)
  const requestId = requestForTool(await read($, ledgerRequestsState), tool)
  if (requestId === undefined) return undefined
  const summary = describeCall(tool, e as Readonly<Record<string, unknown>>, await $.session.cwd())
  const call = { id: e.tool_use_id, tool, summary, isOk: null, durationMs: null }
  await update($, ledgerRequestsState, list =>
    list.map(request => (request.id === requestId ? { ...request, tools: [...request.tools, call] } : request)),
  )
  return requestId
}

async function finishRequestTool($: Engine, requestId: string, callId: string, ran: ToolCallResult, started: number): Promise<void> {
  const durationMs = (await $.clock.now()) - started
  const isOk = ran.deny === undefined && ran.isError !== true
  await update($, ledgerRequestsState, list =>
    list.map(request =>
      request.id !== requestId
        ? request
        : { ...request, tools: request.tools.map(call => (call.id === callId ? { ...call, isOk, durationMs } : call)) },
    ),
  )
}

// ---- Companion ----------------------------------------------------------------

async function companionDir($: Engine): Promise<string> {
  return `${await claudeDir($)}/companion`
}

async function ensureContentDir($: Engine, dir: string): Promise<void> {
  // The shell is the plugin's own page: a copy from an older version is replaced.
  const shell = await $.fs.read(`${$.plugin.root}/assets/index.html`)
  if ((await readIfPresent($, `${dir}/index.html`)) !== shell) await $.fs.write(`${dir}/index.html`, shell)
  if (!(await $.fs.exists(`${dir}/views/manifest.json`))) {
    await $.fs.write(`${dir}/views/manifest.json`, '[]\n')
  }
}

const TOKEN_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Beside the served folder, not in it, so the server never hands the file out.
async function companionTokenPath($: Engine): Promise<string> {
  return `${await claudeDir($)}/companion.token`
}

/**
 * The secret of this person's companion server: a server on the port is ours only when it
 * answers it. Kept in a file only they can read, so a later session knows, and can replace,
 * a server an earlier one left running.
 */
async function companionToken($: Engine): Promise<string> {
  const known = await read($, companionTokenState)
  if (known !== '') return known
  const path = await companionTokenPath($)
  const saved = (await readPlainFile($, path))?.trim() ?? ''
  const token = TOKEN_SHAPE.test(saved) ? saved : crypto.randomUUID()
  if (token !== saved) await writePrivateFile($, path, token)
  await update($, companionTokenState, () => token)
  return token
}

/** Writes `text` to `path` readable by its owner only (0600) from the first byte. */
async function writePrivateFile($: Engine, path: string, text: string): Promise<void> {
  const result = await $.process.run(['sh', '-c', 'umask 077 && printf %s "$1" > "$2"', 'sh', text, path])
  if (result.exitCode !== 0) throw new Error(`could not save ${path}: ${result.stderr.trim()}`)
}

/**
 * Who holds the companion port: nobody, our server, an older companion (it answers /__token,
 * but another token), or another program.
 */
async function probePort($: Engine): Promise<'free' | 'ours' | 'stale' | 'foreign'> {
  let answer: { ok: boolean; text: string }
  try {
    answer = await $.http.fetch(`${companionUrl(config.companionPort)}/__token`)
  } catch {
    // A refused connection is how a free port answers the probe.
    return 'free'
  }
  if (!answer.ok) return 'foreign'
  return answer.text.trim() === (await companionToken($)) ? 'ours' : 'stale'
}

/** Asks a server holding our token to stop; true once it agreed. */
async function stopLeftoverServer($: Engine): Promise<boolean> {
  try {
    const answer = await $.http.fetch(`${companionUrl(config.companionPort)}/__shutdown`, {
      method: 'POST',
      headers: { 'X-Companion-Token': await companionToken($) },
    })
    return answer.ok
  } catch (error) {
    $.ui.log(`dotclaude: stopping the earlier companion server failed: ${errorText(error)}`, { to: 'debug' })
    return false
  }
}

function portHeldMessage(holder: 'stale' | 'foreign'): string {
  const port = config.companionPort
  const free = `free it (lsof -nP -iTCP:${port} -sTCP:LISTEN names the process to quit) or set the companionPort option`
  return holder === 'stale'
    ? `port ${port} is held by a companion server from an earlier version or session; ${free}`
    : `port ${port} is used by another program; ${free}`
}

async function onServerExit($: Engine, child: ServerStream): Promise<void> {
  // Closing clears the handle first, so a match here means the child died on its own.
  if (companionServer !== child) return
  companionServer = undefined
  if (!(await read($, companionIsOpenState))) return
  await update($, companionIsOpenState, () => false)
  $.ui.toast('The companion server stopped; the companion is closed.')
}

function startServer($: Engine, dir: string, token: string): Promise<void> {
  const child = $.process.spawn({ argv: serverArgv(`${$.plugin.root}/assets/server.py`, dir, config.companionPort, token) })
  companionServer = child

  return new Promise((resolve, reject) => {
    let stderrTail = ''
    void (async () => {
      try {
        for await (const { stream, text } of child) {
          if (stream === 'stdout' && text.includes('Serving HTTP')) resolve()
          if (stream === 'stderr') stderrTail = (stderrTail + text).slice(-400)
        }
        reject(new Error(`the server exited: ${stderrTail.trim() || 'no output'}`))
      } catch (error) {
        reject(error)
      } finally {
        await onServerExit($, child).catch(error =>
          $.ui.log(`dotclaude: closing the companion after its server exited failed: ${errorText(error)}`, { to: 'debug' }),
        )
      }
    })()
  })
}

async function ensureServer($: Engine, dir: string): Promise<void> {
  if (companionServer) return
  const port = await probePort($)
  if (port === 'stale' || port === 'foreign') throw new Error(portHeldMessage(port))
  // One an earlier session left running is replaced, so the page runs this version's server
  // and this session can stop it; kept only when it would not stop.
  if (port === 'ours' && !(await stopLeftoverServer($))) return
  await startServer($, dir, await companionToken($))
}

async function isServing($: Engine): Promise<boolean> {
  return companionServer !== undefined || (await probePort($)) === 'ours'
}

async function stopServer(): Promise<void> {
  const child = companionServer
  companionServer = undefined
  // Ending the stream is what kills a child `$.process.spawn` started.
  await child?.return({ code: null, signal: null })
}

async function openBrowserPane($: Engine): Promise<'pane' | 'prompt'> {
  try {
    const result = await $.mcp.call(BROWSER_SERVER, 'preview_start', { url: companionUrl(config.companionPort) })
    if (!result.isError) return 'pane'
    $.ui.log(`dotclaude: ${BROWSER_SERVER} refused preview_start: ${JSON.stringify(result.content).slice(0, 300)}`, { to: 'transcript' })
  } catch (error) {
    $.ui.log(`dotclaude: opening the browser pane failed: ${errorText(error)}`, { to: 'transcript' })
  }
  // Not awaited: a plugin's prompt starts its turn only once the session is idle.
  void $.prompt
    .submit({ text: `Open ${companionUrl(config.companionPort)} in the built-in browser pane.` })
    .catch(error => $.ui.log(`dotclaude: asking Claude to open the companion failed: ${errorText(error)}`, { to: 'debug' }))
  $.ui.toast(`Companion: ${companionUrl(config.companionPort)}`)
  return 'prompt'
}

async function openCompanion($: Engine): Promise<string> {
  const dir = await companionDir($)
  await ensureContentDir($, dir)
  await ensureServer($, dir)
  await update($, companionIsOpenState, () => true)
  const how = await openBrowserPane($)
  return how === 'pane'
    ? `Companion open at ${companionUrl(config.companionPort)}.`
    : `Companion served at ${companionUrl(config.companionPort)}; asked Claude to open it in the browser pane.`
}

async function closeCompanion($: Engine): Promise<void> {
  await stopServer()
  await update($, companionIsOpenState, () => false)
}

// A hot reload kills the child but keeps the open state: restart the server so "open" is
// true again instead of pointing at a dead page.
async function reviveIfStale($: Engine): Promise<boolean> {
  if (!(await read($, companionIsOpenState)) || (await isServing($))) return false
  const dir = await companionDir($)
  await ensureContentDir($, dir)
  await ensureServer($, dir)
  return true
}

/** Opens the companion when it is closed; never closes it. */
async function ensureCompanion($: Engine): Promise<string> {
  if (!(await read($, companionIsOpenState))) return openCompanion($)
  if (await reviveIfStale($)) return `Companion server restarted at ${companionUrl(config.companionPort)}.`
  return `Companion already open at ${companionUrl(config.companionPort)}.`
}

async function readManifest($: Engine, path: string): Promise<CompanionView[]> {
  if (!(await $.fs.exists(path))) return []
  try {
    return JSON.parse(await $.fs.read(path)) as CompanionView[]
  } catch (error) {
    throw new Error(`views/manifest.json is not valid JSON (${errorText(error)})`)
  }
}

async function addToManifest($: Engine, dir: string, view: CompanionView): Promise<void> {
  const path = `${dir}/views/manifest.json`
  // A slug shown again moves to the end, so the shell treats it as the newest.
  const views = (await readManifest($, path)).filter(one => one.slug !== view.slug)
  await $.fs.write(path, `${JSON.stringify([...views, view], null, 2)}\n`)
}

/** Adds an .html file as is, or an .md file rendered, as a companion view; opens the companion if closed. */
async function showFile($: Engine, path: string): Promise<string> {
  const extension = showableExtension(path)
  if (!(await isProjectFile($, path))) throw new Error('only files inside this project can be shown, and no symbolic links')
  const source = await $.fs.read(path)
  const name = (path.split('/').at(-1) ?? path).replace(/\.[^.]+$/, '')
  const title = (extension === 'md' ? markdownTitle(source) : htmlTitle(source)) ?? name
  const html = extension === 'md' ? markdownPage(title, renderMarkdown(source)) : source
  return addView($, slugify(name), title, html)
}

/** Adds a page to the companion's views, newest last; opens the companion when it is closed. */
async function addView($: Engine, slug: string, title: string, html: string): Promise<string> {
  const dir = await companionDir($)
  await ensureContentDir($, dir)
  await $.fs.write(`${dir}/views/${slug}.html`, html)
  await addToManifest($, dir, { slug, title, createdAt: await $.clock.now() })

  const opened = (await read($, companionIsOpenState)) ? '' : ` ${await openCompanion($)}`
  return `Showing "${title}" in the companion.${opened}`
}

async function isOutputLocation($: Engine, path: string): Promise<boolean> {
  if (await isProjectFile($, path)) return true
  const stat = await $.fs.stat(path).catch(() => undefined)
  return stat !== undefined && !stat.isLink && isScratchpadPath(path, await $.session.id())
}

// Larger files would be read whole and copied into the served folder; they get a path card.
const OUTPUT_MAX_BYTES = 2 * 1024 * 1024

function outputSlug(path: string): { fileName: string; slug: string } {
  const fileName = path.split('/').at(-1) ?? path
  return { fileName, slug: slugify(fileName.replace(/\.[^.]+$/, '')) }
}

async function showPathOnly($: Engine, path: string): Promise<void> {
  const { fileName, slug } = outputSlug(path)
  await addView($, slug, fileName, outputPage(fileName, fileCard(path), path)).catch(error =>
    $.ui.toast(`Companion: could not show ${path}: ${errorText(error)}`),
  )
}

/** Adds a file the user should see to the companion, drawn by its kind; a failure is a toast, never thrown. */
async function showOutput($: Engine, path: string): Promise<void> {
  try {
    const kind = outputKind(path)
    const { fileName, slug } = outputSlug(path)
    const size = (await $.fs.stat(path)).size
    if (kind === 'other' || size > OUTPUT_MAX_BYTES) {
      await showPathOnly($, path)
      return
    }
    const source = await $.fs.read(path)
    if (kind === 'html') {
      await addView($, slug, htmlTitle(source) ?? fileName, source)
      return
    }
    const title = (kind === 'md' ? markdownTitle(source) : undefined) ?? fileName
    const body =
      kind === 'md' ? renderMarkdown(source) : kind === 'csv' ? csvTable(source) : kind === 'json' ? jsonBlock(source) : source
    await addView($, slug, title, outputPage(title, body, path))
  } catch (error) {
    $.ui.toast(`Companion: could not show ${path}: ${errorText(error)}`)
  }
}

async function runCompanionCommand($: Engine, args: string): Promise<string> {
  const trimmed = args.trim()
  const show = /^show\s+(.+)$/.exec(trimmed)
  if (trimmed !== '' && !show?.[1]) return COMPANION_USAGE
  const said = show?.[1] ? await showFile($, show[1].trim()) : await ensureCompanion($)
  await openView($, 'companion')
  return said
}

// ---- Mac ----------------------------------------------------------------------

const MAC_SAMPLE_EVERY_MS = 5000

function startSampling($: Engine): void {
  if (macSampler !== undefined) return
  void sampleOnce($)
  macSampler = $.clock.every(MAC_SAMPLE_EVERY_MS, () => void sampleOnce($))
}

function stopSampling(): void {
  macSampler?.cancel()
  macSampler = undefined
}

async function sampleOnce($: Engine): Promise<void> {
  const run = (argv: readonly string[], timeoutMs: number) => runQuiet($, argv, timeoutMs)
  const next = await takeSample(run, await read($, macSnapshotState))
  await update($, macSnapshotState, () => next)
}

async function endProcess($: Engine, { pid, name }: Process): Promise<void> {
  if (!(await confirm($, `End ${name} (pid ${pid})?`, 'End process', 'Confirm'))) return
  // SIGTERM only, so the process can still clean up after itself.
  const ended = await runQuiet($, ['kill', String(pid)], 3000)
  $.ui.toast(ended === undefined ? `Could not end ${name} (pid ${pid}).` : `Asked ${name} (pid ${pid}) to quit.`)
  await sampleOnce($)
}

async function stopContainer($: Engine, name: string): Promise<void> {
  if (!(await confirm($, `Stop the container ${name}?`, 'Stop container', 'Confirm'))) return
  // docker stop waits up to 10 s for the container before it kills it.
  const stopped = await runQuiet($, ['docker', 'stop', name], 15000)
  $.ui.toast(stopped === undefined ? `Could not stop ${name}.` : `Stopped ${name}.`)
  await sampleOnce($)
}

async function showLogs($: Engine, name: string): Promise<void> {
  try {
    // docker logs replays the container's stderr on its own stderr, so both count.
    const { stdout, stderr } = await $.process.run(['docker', 'logs', '--tail', '50', name], { timeoutMs: 5000 })
    await update($, macLogsState, () => ({ name, text: `${stdout}${stderr}`.trimEnd() }))
  } catch (error) {
    $.ui.toast(`Could not read the logs of ${name}.`)
    $.ui.log(`dotclaude: docker logs ${name}: ${errorText(error)}`, { to: 'debug' })
  }
}

/** Runs a command; its stdout on exit 0, else undefined (the reason goes to the debug log). */
async function runQuiet($: Engine, argv: readonly string[], timeoutMs: number): Promise<string | undefined> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs })
    if (exitCode === 0) return stdout
    $.ui.log(`dotclaude: ${argv[0]} exited ${exitCode}: ${stderr.trim()}`, { to: 'debug' })
  } catch (error) {
    $.ui.log(`dotclaude: ${argv[0]} did not run: ${errorText(error)}`, { to: 'debug' })
  }
  return undefined
}

// ---- Brain --------------------------------------------------------------------

const BRAIN_REFRESH_MS = 10_000
const BRAIN_USAGE = 'Usage: /brain opens your notes vault; /brain capture [text] captures this session.'

type ScribeStage = 'draft' | 'final'

async function vaultRoot($: Engine): Promise<string> {
  return expandHome(config.vaultPath, await homeDir($))
}

async function readIfExists($: Engine, file: string): Promise<string | undefined> {
  return (await $.fs.exists(file)) ? String(await $.fs.read(file)) : undefined
}

async function listNotes($: Engine, root: string, folder: string): Promise<NoteRef[]> {
  const dir = `${root}/${folder}`
  return (await $.fs.exists(dir)) ? newestNotes(await $.fs.list(dir), folder) : []
}

async function refreshVault($: Engine): Promise<void> {
  const root = await vaultRoot($)
  const nowMs = await $.clock.now()
  const todayPath = `daily/${localDate(nowMs)}.md`
  const isMissing = !(await $.fs.exists(root))
  const daily = isMissing ? undefined : await readIfExists($, `${root}/${todayPath}`)
  const view: VaultView = {
    vaultName: config.vaultName,
    missingPath: isMissing ? root : null,
    inbox: await listNotes($, root, 'inbox'),
    recent: await listNotes($, root, 'notes'),
    today: { path: todayPath, exists: daily !== undefined, captures: daily === undefined ? 0 : countCaptures(daily) },
  }
  // The view redraws on every write, so an unchanged vault writes nothing.
  if (JSON.stringify(view) !== JSON.stringify(await read($, brainViewState))) await update($, brainViewState, () => view)
}

async function runLines($: Engine, argv: string[], okCodes: number[]): Promise<string[]> {
  const ran = await $.process.run(argv)
  if (!okCodes.includes(ran.exitCode)) throw new Error(`${argv[0]} failed: ${ran.stderr.trim()}`)
  return ran.stdout.split('\n').filter(Boolean)
}

async function runSearch($: Engine, query: string): Promise<void> {
  const trimmed = query.trim()
  if (trimmed === '') {
    await update($, brainSearchState, () => ({ query: '', hits: [] }))
    return
  }
  const root = await vaultRoot($)
  const allNotes = await runLines($, ['find', root, '-name', '*.md', '-not', '-path', '*/.obsidian/*'], [0])
  // grep exits 1 when nothing matches, which is an answer, not an error.
  const contentHits = await runLines($, ['grep', '-rilF', '--include=*.md', '--exclude-dir=.obsidian', '--', trimmed, root], [0, 1])
  const hits = mergeHits(root, trimmed, allNotes, contentHits)
  await update($, brainSearchState, () => ({ query: trimmed, hits }))
}

/** Every note path the scribe may append to instead of creating a near-duplicate. */
async function noteIndex($: Engine, root: string): Promise<string[]> {
  const index: string[] = []
  for (const folder of NOTE_FOLDERS) {
    const dir = `${root}/${folder}`
    if (!(await $.fs.exists(dir))) continue
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) index.push(`${folder}/${entry.name}`)
    }
  }
  return index
}

function startBrainTicker($: Engine): void {
  brainTicker ??= $.clock.every(BRAIN_REFRESH_MS, () => {
    refreshVault($).catch(error => $.ui.log(`dotclaude: vault refresh failed: ${errorText(error)}`, { to: 'debug' }))
  })
}

function stopBrainTicker(): void {
  brainTicker?.cancel()
  brainTicker = undefined
}

async function openNote($: Engine, url: string): Promise<void> {
  const ran = await $.process.run(['open', url])
  if (ran.exitCode !== 0) $.ui.toast(`Could not open Obsidian: ${ran.stderr.trim()}`)
}

async function setCapture($: Engine, next: CaptureState): Promise<void> {
  await update($, brainCaptureState, () => next)
}

async function failCapture($: Engine, error: unknown): Promise<void> {
  await setCapture($, { phase: 'failed', reason: errorText(error) })
  $.ui.toast(`Capture failed: ${errorText(error)}`)
}

async function buildScribePrompt($: Engine, extraText: string): Promise<string> {
  const messages = await $.session.messages()
  if ('deny' in messages) throw new Error(`The session transcript is not readable: ${messages.deny}`)
  const transcript = buildTranscript(messages)
  if (transcript === '' && extraText.trim() === '') throw new Error('There is nothing in this session to capture yet')

  const root = await vaultRoot($)
  // The conventions skill, where one is installed, holds the vault's own conventions.
  const skill = await readIfExists($, `${await claudeDir($)}/skills/${config.conventionsSkill}/SKILL.md`)
  return scribeDraftPrompt({
    date: localDate(await $.clock.now()),
    conventions: skill ?? GENERIC_CONVENTIONS,
    noteIndex: await noteIndex($, root),
    transcript,
    extraText,
  })
}

/**
 * Runs the scribe as an independent background agent; its answer arrives at
 * `turn.complete` (see onScribeTurn). Only when no agent can be spawned does it
 * fall back to one model call with the same instructions.
 */
async function runScribe($: Engine, stage: ScribeStage, unmasked: string, draft: string): Promise<void> {
  // The transcript can hold keys the session saw; the scribe never gets them.
  const prompt = redactSecrets(unmasked)
  await setCapture($, { phase: 'working', stage, agentId: '', draftPrompt: draft })
  const spawned = await $.agent
    .spawn({ subagentType: SCRIBE_TYPE, prompt, description: 'Capture the session to your notes vault' })
    .catch((error: unknown) => ({ deny: errorText(error), agentId: undefined }))
  if (spawned.agentId !== undefined) {
    await setCapture($, { phase: 'working', stage, agentId: spawned.agentId, draftPrompt: draft })
    return
  }

  $.ui.log(`dotclaude: scribe agent unavailable (${spawned.deny ?? 'no agent id'}), using a model call`, { to: 'debug' })
  const reply = await $.model.complete({ model: SCRIBE_MODEL, system: SCRIBE_PROMPT, prompt, maxTokens: 8000 })
  if (!reply.isAnswered) throw new Error(`The scribe could not answer (${reply.reason})`)
  await handleScribeAnswer($, stage, reply.text, draft)
}

/** Asks each question in turn; null when the person dismisses one, which cancels the capture. */
async function askAll($: Engine, questions: ScribeQuestion[]): Promise<Record<string, string> | null> {
  const replies: Record<string, string> = {}
  for (const [index, question] of questions.entries()) {
    await setCapture($, { phase: 'question', question, position: index + 1, total: questions.length })
    try {
      replies[question.id] = await $.ui.ask(question.question, question.options.slice(0, 4))
    } catch {
      // ui.ask rejects only when the dialog is dismissed or nobody can be asked: both mean stop.
      return null
    }
  }
  return replies
}

/** Never overwrites: an existing note gets a dated section appended. */
async function writeNote($: Engine, root: string, note: ScribeNote, date: string, source: string): Promise<void> {
  const file = `${root}/${note.path}`
  const existing = await readIfExists($, file)
  const text = existing === undefined ? newNoteText(note, date, source) : appendDatedSection(existing, note.body, date)
  await $.fs.write(file, text)
}

/** Asks before anything is written, showing what would be; true only on Save. */
async function confirmSave($: Engine, answer: ScribeAnswer): Promise<boolean> {
  const question = `Save these notes?\n\n${capturePreview(answer)}`
  return (await $.ui.ask(question, ['Save', 'Cancel']).catch(() => 'Cancel')) === 'Save'
}

/** Refuses a path that goes through a symbolic link anywhere below the vault's root. */
async function refuseLinks($: Engine, root: string, relative: string): Promise<void> {
  const segments = relative.split('/')
  for (let i = 1; i <= segments.length; i++) {
    const stat = await $.fs.stat(`${root}/${segments.slice(0, i).join('/')}`).catch(() => undefined)
    if (stat?.isLink) throw new Error(`Refused to write ${relative}: it goes through a symbolic link`)
  }
}

/** Writes the capture after asking; the paths written, or null when the person cancels. */
async function saveCapture($: Engine, proposed: ScribeAnswer): Promise<string[] | null> {
  const answer = cleanAnswer(proposed)
  const invalid = answer.notes.find(note => !isAllowedNotePath(note.path))
  if (invalid) throw new Error(`The scribe proposed a path outside the note folders: ${invalid.path}`)
  if (!(await confirmSave($, answer))) return null

  const root = await vaultRoot($)
  const nowMs = await $.clock.now()
  const date = localDate(nowMs)
  const project = (await $.session.cwd()).split('/').pop()
  const source = `Claude Code session in ${project}, ${date}`
  const dailyPath = `daily/${date}.md`
  for (const path of [...answer.notes.map(note => note.path), dailyPath]) await refuseLinks($, root, path)
  for (const note of answer.notes) await writeNote($, root, note, date, source)

  const daily = (await readIfExists($, `${root}/${dailyPath}`)) ?? newDailyText(date)
  await $.fs.write(`${root}/${dailyPath}`, addCaptureLine(daily, captureLine(answer, localTime(nowMs))))

  return [...answer.notes.map(note => note.path), dailyPath]
}

async function finishCapture($: Engine, answer: ScribeAnswer): Promise<void> {
  const paths = await saveCapture($, answer)
  if (paths === null) {
    await setCapture($, { phase: 'idle' })
    $.ui.toast('Capture not saved')
    return
  }
  await setCapture($, { phase: 'saved', paths })
  $.ui.toast(paths.length > 1 ? `Saved to ${paths[0]} and ${paths.length - 1} more` : `Saved to ${paths[0]}`)
  await refreshVault($)
}

async function handleScribeAnswer($: Engine, stage: ScribeStage, text: string, draft: string): Promise<void> {
  const answer = parseScribeAnswer(text)
  if (stage === 'final' || answer.questions.length === 0) return finishCapture($, answer)

  const replies = await askAll($, answer.questions)
  if (replies === null) {
    await setCapture($, { phase: 'idle' })
    $.ui.toast('Capture cancelled')
    return
  }
  await runScribe($, 'final', finalPrompt(draft, answer, replies), draft)
}

async function startCapture($: Engine, extraText: string): Promise<void> {
  const current = await read($, brainCaptureState)
  if (current.phase === 'working' || current.phase === 'question') {
    $.ui.toast('A capture is already running')
    return
  }
  try {
    const prompt = await buildScribePrompt($, extraText)
    await runScribe($, 'draft', prompt, prompt)
  } catch (error) {
    await failCapture($, error)
  }
}

/** Picks up the scribe's answer when its turn ends; every other turn passes untouched. */
async function onScribeTurn($: Engine, agentId: string, reason: string, answer: string): Promise<void> {
  const current = await read($, brainCaptureState)
  if (current.phase !== 'working' || current.agentId !== agentId) return
  try {
    if (reason !== 'answer') throw new Error(`The scribe stopped (${reason})`)
    await handleScribeAnswer($, current.stage, answer, current.draftPrompt)
  } catch (error) {
    await failCapture($, error)
  }
}

// ---- Radar --------------------------------------------------------------------

const RADAR_SESSION_LIMIT = 40
// $.fs.read rejects past 4 MiB; a bigger transcript is read from its tail, kept under
// process.run's 4 MiB stdout cap too.
const RADAR_READ_CAP_BYTES = 4 * 1024 * 1024
const RADAR_TAIL_BYTES = 3 * 1024 * 1024
const RADAR_MODEL = 'sonnet'

type Transcript = { path: string; project: string; size: number; mtimeMs: number }

async function listTranscripts($: Engine, projectsDir: string): Promise<Transcript[]> {
  if (!(await $.fs.exists(projectsDir))) return []
  const projects = (await $.fs.list(projectsDir)).filter(entry => entry.kind === 'dir')
  const perProject = await Promise.all(
    projects.map(async project => {
      const dir = `${projectsDir}/${project.name}`
      const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
      return files.map(f => ({ path: `${dir}/${f.name}`, project: project.name, size: f.size, mtimeMs: f.mtimeMs }))
    }),
  )
  return perProject
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RADAR_SESSION_LIMIT)
}

async function readTranscript($: Engine, file: Transcript): Promise<string> {
  if (file.size <= RADAR_READ_CAP_BYTES) return $.fs.read(file.path)
  const tail = await $.process.run(['tail', '-c', String(RADAR_TAIL_BYTES), file.path])
  if (tail.exitCode !== 0) throw new Error(`Could not read ${file.path}: ${tail.stderr.trim()}`)
  return tail.stdout
}

async function readSessions($: Engine, claude: string): Promise<SessionDigest[]> {
  const files = await listTranscripts($, `${claude}/projects`)
  const sessions: SessionDigest[] = []
  // One at a time: transcripts run to megabytes each.
  for (const file of files) {
    const digest = extractSession(await readTranscript($, file), file.project)
    if (digest.prompts.length > 0) {
      sessions.push({ ...digest, date: digest.date || new Date(file.mtimeMs).toISOString().slice(0, 10) })
    }
  }
  return sessions
}

async function namesIn($: Engine, dir: string, suffix: string): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return []
  return (await $.fs.list(dir))
    .filter(entry => !entry.name.startsWith('.') && entry.name.endsWith(suffix))
    .map(entry => entry.name.slice(0, entry.name.length - suffix.length))
}

async function installedPlugins($: Engine, claude: string): Promise<string[]> {
  const path = `${claude}/plugins/installed_plugins.json`
  if (!(await $.fs.exists(path))) return []
  const parsed = JSON.parse(await $.fs.read(path)) as { plugins?: Record<string, unknown> }
  // Keys are `<plugin>@<marketplace>`.
  return Object.keys(parsed.plugins ?? {}).map(key => key.split('@')[0] ?? key)
}

async function existingNames($: Engine, claude: string): Promise<string[]> {
  const [skills, agents, plugins, commands] = await Promise.all([
    namesIn($, `${claude}/skills`, ''),
    namesIn($, `${claude}/agents`, '.md'),
    installedPlugins($, claude),
    $.command.list(),
  ])
  const all = [...skills, ...agents, ...plugins, ...commands.map(c => c.name)]
  return [...new Set(all)].sort()
}

async function runScan($: Engine): Promise<RadarScan> {
  const claude = await claudeDir($)
  const [sessions, vaultNotes, existing, dismissed, saved] = await Promise.all([
    readSessions($, claude),
    namesIn($, `${await vaultRoot($)}/notes`, '.md'),
    existingNames($, claude),
    $.store.get(STORE_KEYS.dismissed).then(v => storedList<string>(v)),
    $.store.get(STORE_KEYS.later).then(v => storedList<RadarIdea>(v)),
  ])
  if (sessions.length === 0) throw new Error(`No Claude Code sessions with your prompts were found in ${claude}/projects.`)

  const reply = await $.model.complete({
    model: RADAR_MODEL,
    prompt: redactSecrets(buildScanPrompt({ sessions, vaultNotes, existing, dismissed })),
    maxTokens: 4096,
    timeoutMs: 180_000,
  })
  if (!reply.isAnswered) throw new Error(`The model did not answer: ${whyUnanswered(reply)}. Try again in a moment.`)
  const ideas = parseIdeas(reply.text)
  if (ideas === undefined) throw new Error("The model's answer was not the JSON Radar asked for. Try again.")

  const hiddenIds = [...dismissed, ...saved.map(idea => idea.id)]
  return {
    scannedAt: await $.clock.now(),
    sessionCount: sessions.length,
    ideas: sortByKind(filterIdeas(ideas, existing, hiddenIds)),
  }
}

// The store is what survives sessions; state mirrors it so the view redraws on change.
async function loadRadarFromStore($: Engine): Promise<void> {
  const [scan, saved] = await Promise.all([$.store.get(STORE_KEYS.lastScan), $.store.get(STORE_KEYS.later)])
  await update($, radarLastScanState, () => (scan ?? null) as RadarScan | null)
  await update($, radarLaterState, () => storedList<RadarIdea>(saved))
}

async function scanNow($: Engine): Promise<void> {
  if ((await read($, radarStatusState)).isScanning) return
  await update($, radarStatusState, () => ({ isScanning: true, error: null }))
  try {
    const scan = await runScan($)
    await $.store.set(STORE_KEYS.lastScan, scan)
    await update($, radarLastScanState, () => scan)
    await update($, radarStatusState, () => ({ isScanning: false, error: null }))
    $.ui.toast(`Scanned ${scan.sessionCount} sessions`)
  } catch (error) {
    await update($, radarStatusState, () => ({ isScanning: false, error: errorText(error) }))
  }
}

async function removeFromScan($: Engine, id: string): Promise<void> {
  const scan = await update($, radarLastScanState, current =>
    current === null ? null : { ...current, ideas: current.ideas.filter(idea => idea.id !== id) },
  )
  await $.store.set(STORE_KEYS.lastScan, scan)
}

async function draftIdea($: Engine, idea: RadarIdea): Promise<void> {
  await $.prompt.submit({ text: radarDraftPrompt(idea) })
  $.ui.toast(`Started a brainstorm for ${idea.title}`)
}

async function keepForLater($: Engine, idea: RadarIdea): Promise<void> {
  const list = await update($, radarLaterState, current => [...current.filter(one => one.id !== idea.id), idea])
  await $.store.set(STORE_KEYS.later, list)
  await removeFromScan($, idea.id)
}

async function dismissIdea($: Engine, idea: RadarIdea): Promise<void> {
  const dismissed = storedList<string>(await $.store.get(STORE_KEYS.dismissed))
  await $.store.set(STORE_KEYS.dismissed, [...new Set([...dismissed, idea.id])])
  const list = await update($, radarLaterState, current => current.filter(one => one.id !== idea.id))
  await $.store.set(STORE_KEYS.later, list)
  await removeFromScan($, idea.id)
}

// ---- Radar advisor ------------------------------------------------------------

/** A marketplace this machine knows: its name, its GitHub repo when it has one, its local copy. */
type Marketplace = { name: string; repo: string | null; dir: string }

async function readJsonIfPresent($: Engine, path: string): Promise<unknown> {
  if (!(await $.fs.exists(path))) return undefined
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    // A half-written or hand-broken file reads as absent; the scan goes on without it.
    return undefined
  }
}

/** The marketplaces known_marketplaces.json lists, plus any folder under plugins/marketplaces it does not. */
async function knownMarketplaces($: Engine, claude: string): Promise<Marketplace[]> {
  const folder = `${claude}/plugins/marketplaces`
  const known = ((await readJsonIfPresent($, `${claude}/plugins/known_marketplaces.json`)) ?? {}) as Record<string, { source?: unknown; installLocation?: unknown }>
  const markets: Marketplace[] = Object.entries(known).map(([name, entry]) => ({
    name,
    repo: githubRepoOf(entry.source),
    dir: typeof entry.installLocation === 'string' ? entry.installLocation : `${folder}/${name}`,
  }))
  const folders = (await $.fs.exists(folder)) ? (await $.fs.list(folder)).filter(entry => entry.kind === 'dir') : []
  for (const { name } of folders) {
    if (!markets.some(market => market.name === name)) markets.push({ name, repo: null, dir: `${folder}/${name}` })
  }
  return markets
}

/**
 * A repo's catalog from GitHub, in either layout. `text` is null when the repo has none
 * (or answered an error); `isUnreachable` says GitHub could not be reached at all.
 */
async function fetchCatalog($: Engine, repo: string): Promise<{ text: string | null; isUnreachable: boolean }> {
  for (const path of CATALOG_PATHS) {
    const fetched = await $.http.fetch(catalogUrl(repo, path)).catch(() => undefined)
    if (fetched === undefined) return { text: null, isUnreachable: true }
    if (fetched.ok) return { text: fetched.text, isUnreachable: false }
  }
  return { text: null, isUnreachable: false }
}

async function localCatalog($: Engine, market: Marketplace): Promise<CatalogEntry[] | null> {
  for (const path of CATALOG_PATHS) {
    const file = `${market.dir}/${path}`
    if (await $.fs.exists(file)) return parseCatalog(await $.fs.read(file), market.name, market.repo, true)
  }
  return null
}

/**
 * Every catalog within reach: each known marketplace's, fresh from GitHub when it lives
 * there (the copy on this Mac when the fetch fails), and the well-known ones not added yet.
 */
async function readCatalogs($: Engine, claude: string): Promise<{ entries: CatalogEntry[]; count: number; note: string | null }> {
  const markets = await knownMarketplaces($, claude)
  let isGitHubUnreachable = false
  const known = await Promise.all(
    markets.map(async market => {
      const fetched = market.repo === null ? null : await fetchCatalog($, market.repo)
      if (fetched?.isUnreachable) isGitHubUnreachable = true
      const text = fetched?.text ?? null
      return text === null ? localCatalog($, market) : parseCatalog(text, market.name, market.repo, true)
    }),
  )
  const knownRepos = new Set(markets.map(market => market.repo))
  const extra = await Promise.all(
    WELL_KNOWN_REPOS.filter(repo => !knownRepos.has(repo)).map(async repo => {
      const fetched = await fetchCatalog($, repo)
      if (fetched.isUnreachable) isGitHubUnreachable = true
      const name = fetched.text === null ? null : catalogName(fetched.text)
      return fetched.text === null || name === null ? null : parseCatalog(fetched.text, name, repo, false)
    }),
  )
  const catalogs = [...known, ...extra].filter((list): list is CatalogEntry[] => list !== null)
  return {
    entries: catalogs.flat(),
    count: catalogs.length,
    note: isGitHubUnreachable ? 'GitHub could not be reached, so the suggestions come from the catalogs on this Mac.' : null,
  }
}

async function readInstalled($: Engine, claude: string): Promise<Set<string>> {
  const installedPath = `${claude}/plugins/installed_plugins.json`
  const installed = (await $.fs.exists(installedPath)) ? await $.fs.read(installedPath) : ''
  const settings = (await readJsonIfPresent($, `${claude}/settings.json`)) as { enabledPlugins?: unknown } | undefined
  return installedKeys(installed, settings?.enabledPlugins)
}

async function runAdvisorScan($: Engine): Promise<AdvisorResult> {
  const claude = await claudeDir($)
  const [catalogs, installed, hidden, sessions] = await Promise.all([
    readCatalogs($, claude),
    readInstalled($, claude),
    $.store.get(ADVISOR_STORE_KEYS.hidden).then(value => storedList<string>(value)),
    readSessions($, claude),
  ])
  const scannedAt = await $.clock.now()
  const pool = candidates(catalogs.entries, installed, hidden)
  if (pool.length === 0) {
    const note = catalogs.note ?? 'Every plugin in your catalogs is installed or hidden already.'
    return { scannedAt, catalogCount: catalogs.count, picks: [], note }
  }
  const reply = await $.model.complete({
    model: RADAR_MODEL,
    prompt: redactSecrets(buildAdvisorPrompt({ entries: pool, sessions, installed: [...installed] })),
    maxTokens: 2048,
    timeoutMs: 180_000,
  })
  if (!reply.isAnswered) throw new Error(`The model did not answer: ${whyUnanswered(reply)}. Try again in a moment.`)
  return { scannedAt, catalogCount: catalogs.count, picks: parsePicks(reply.text, pool), note: catalogs.note }
}

async function scanAdvisor($: Engine): Promise<void> {
  if ((await read($, advisorStatusState)).isScanning) return
  await update($, advisorStatusState, () => ({ isScanning: true, error: null }))
  try {
    const result = await runAdvisorScan($)
    await $.store.set(ADVISOR_STORE_KEYS.last, result)
    await update($, advisorResultState, () => result)
    await update($, advisorStatusState, () => ({ isScanning: false, error: null }))
  } catch (error) {
    await update($, advisorStatusState, () => ({ isScanning: false, error: errorText(error) }))
  }
}

// The store keeps the last scan across sessions; state mirrors it so the view redraws on change.
async function loadAdvisorFromStore($: Engine): Promise<void> {
  const last = await $.store.get(ADVISOR_STORE_KEYS.last)
  await update($, advisorResultState, () => (last ?? null) as AdvisorResult | null)
}

async function copyInstall($: Engine, pick: AdvisorPick, surface: RenderSurface): Promise<void> {
  const copied = await $.ui.copy({ text: installCommand(pick), surface })
  $.ui.toast(copied.isCopied ? 'Install command copied' : 'Could not copy the install command')
}

/** Hides a plugin for good: it is dropped from the shown picks and never suggested again. */
async function hideAdvisorPick($: Engine, pick: AdvisorPick): Promise<void> {
  const hidden = storedList<string>(await $.store.get(ADVISOR_STORE_KEYS.hidden))
  await $.store.set(ADVISOR_STORE_KEYS.hidden, [...new Set([...hidden, entryKey(pick)])])
  const result = await update($, advisorResultState, current =>
    current === null ? null : { ...current, picks: current.picks.filter(one => entryKey(one) !== entryKey(pick)) },
  )
  await $.store.set(ADVISOR_STORE_KEYS.last, result)
}

// ---- Git ----------------------------------------------------------------------

/** Runs argv: the boundary where a refused start, a timeout or an exit code become text. */
async function runGit($: Engine, argv: readonly string[], cwd: string, timeoutMs = LOCAL_TIMEOUT_MS): Promise<RunOutcome> {
  if (isForcePush(argv)) return { isOk: false, error: 'Refused: the Git panel never force pushes.' }
  try {
    const result = await $.process.run(withoutFsmonitor(argv), { cwd, timeoutMs })
    if (result.exitCode === 0) return { isOk: true, stdout: result.stdout }
    return { isOk: false, error: failureText(argv[0] ?? '', result.exitCode, result.stderr, result.stdout) }
  } catch (error) {
    return { isOk: false, error: `Could not run ${argv[0]}: ${errorText(error)}` }
  }
}

/** Every git command runs with the fsmonitor hook off: a repository's config never starts a program here. */
function withoutFsmonitor(argv: readonly string[]): readonly string[] {
  return argv[0] === 'git' ? ['git', '-c', 'core.fsmonitor=false', ...argv.slice(1)] : argv
}

async function readGitHub($: Engine, cwd: string): Promise<GitPanelGitHub> {
  const auth = await runGit($, ['gh', 'auth', 'status'], cwd, GH_TIMEOUT_MS)
  if (!auth.isOk) {
    const reason = auth.error.startsWith('Could not run gh')
      ? 'GitHub CLI (gh) is not installed, so only the current remote is offered.'
      : 'GitHub CLI is not signed in (run gh auth login), so only the current remote is offered.'
    return { isAvailable: false, reason }
  }
  const argv = ['gh', 'repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate,url']
  const listed = await runGit($, argv, cwd, GH_TIMEOUT_MS)
  if (!listed.isOk) return { isAvailable: false, reason: `GitHub CLI could not list your repos: ${listed.error}` }
  try {
    return { isAvailable: true, repos: JSON.parse(listed.stdout) as GitPanelGitHubRepo[] }
  } catch {
    return { isAvailable: false, reason: 'GitHub CLI answered with a repo list that is not JSON.' }
  }
}

async function readRepo($: Engine, root: string): Promise<GitPanelSnapshot> {
  const git = (...args: string[]) => runGit($, ['git', ...args], root)
  const [branch, status, remotes, heads, upstream, counts, github] = await Promise.all([
    git('branch', '--show-current'),
    git('status', '--porcelain', '-uall'),
    git('remote', '-v'),
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads'),
    git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'),
    git('rev-list', '--left-right', '--count', '@{upstream}...HEAD'),
    readGitHub($, root),
  ])
  if (!status.isOk) return { kind: 'error', message: status.error }
  const current = branch.isOk ? branch.stdout.trim() : ''
  const branches = heads.isOk ? lines(heads.stdout).map(line => line.trim()) : []
  return {
    kind: 'repo',
    root,
    folderName: folderName(root),
    branch: current,
    // No upstream is normal for a new branch; the panel says so instead of an error.
    upstream: upstream.isOk ? upstream.stdout.trim() : null,
    ...(counts.isOk ? parseAheadBehind(counts.stdout) : { ahead: 0, behind: 0 }),
    files: lines(status.stdout),
    branches: current && !branches.includes(current) ? [current, ...branches] : branches,
    remotes: remotes.isOk ? parseRemotes(remotes.stdout) : [],
    github,
  }
}

async function readGitSnapshot($: Engine): Promise<GitPanelSnapshot> {
  const cwd = await $.session.cwd()
  const top = await runGit($, ['git', 'rev-parse', '--show-toplevel'], cwd)
  if (top.isOk) return readRepo($, top.stdout.trim())
  return top.error.startsWith('Could not run git') ? { kind: 'error', message: top.error } : { kind: 'not-repo', cwd }
}

/** The commit message the ledger drafts from this session's entries, straight from its own function. */
async function draftFromLedger($: Engine): Promise<Pick<GitPanelForm, 'message' | 'ledgerNote'>> {
  const drafted = await draftCommitMessage($).catch(error => ({ status: 'failed', reason: errorText(error) }) as LedgerDraft)
  if (drafted.status === 'ready') return { message: drafted.text, ledgerNote: undefined }
  const reason = drafted.status === 'failed' ? drafted.reason : 'no draft'
  return { message: '', ledgerNote: `Could not draft from the ledger: ${reason}` }
}

/** Reads the repository again; drafts the commit message from the ledger while the field is empty. */
async function refreshGit($: Engine): Promise<void> {
  const snapshot = await readGitSnapshot($)
  await update($, gitSnapshotState, () => snapshot)
  if (snapshot.kind !== 'repo' || snapshot.files.length === 0) return
  if ((await read($, gitFormState)).message.trim() !== '') return
  const drafted = await draftFromLedger($)
  await update($, gitFormState, form => (form.message.trim() === '' ? { ...form, ...drafted } : form))
}

function setGitForm($: Engine, change: Partial<GitPanelForm>): Promise<GitPanelForm> {
  return update($, gitFormState, form => ({ ...form, ...change }))
}

function appendGitLog($: Engine, step: GitPanelStep): Promise<GitPanelStep[]> {
  return update($, gitLogState, log => [...log, step])
}

/** Asks with several answers; a dismissed dialog (it rejects) counts as Cancel, never as a yes. */
async function choose($: Engine, question: string, options: string[]): Promise<string> {
  try {
    return await $.ui.ask(question, options)
  } catch {
    return 'Cancel'
  }
}

/**
 * Runs the steps in order and stops at the first failure, then runs the undo of every
 * step that already ran, newest first, so the repo is left as it was (a commit has no
 * undo: taking it back would rewrite history).
 */
async function runSteps($: Engine, steps: readonly Step[], cwd: string): Promise<boolean> {
  const done: Step[] = []
  let previousStdout = ''
  for (const step of steps) {
    const outcome = await runGit($, stepArgv(step, previousStdout), cwd, step.timeoutMs)
    await appendGitLog($, { label: step.label, isOk: outcome.isOk, detail: outcome.isOk ? 'ok' : outcome.error })
    if (!outcome.isOk) {
      await undoSteps($, done, cwd)
      return false
    }
    done.push(step)
    previousStdout = outcome.stdout
  }
  return true
}

async function undoSteps($: Engine, done: readonly Step[], cwd: string): Promise<void> {
  for (const step of [...done].reverse()) {
    if (!step.undo) continue
    const outcome = await runGit($, step.undo, cwd)
    await appendGitLog($, { label: `Undo: ${step.label}`, isOk: outcome.isOk, detail: outcome.isOk ? 'ok' : outcome.error })
  }
}

/** `git check-ref-format --branch` is git's own rule for a branch name; undefined when valid. */
async function branchNameError($: Engine, cwd: string, name: string): Promise<string | undefined> {
  const checked = await runGit($, ['git', 'check-ref-format', '--branch', name], cwd)
  return checked.isOk ? undefined : `${name} is not a valid branch name.`
}

async function checkNewBranch($: Engine, value: string): Promise<void> {
  const snapshot = await read($, gitSnapshotState)
  const root = snapshot.kind === 'repo' ? snapshot.root : await $.session.cwd()
  const error = value.trim() === '' ? undefined : await branchNameError($, root, value.trim())
  await setGitForm($, { newBranchName: value, branchError: error })
}

async function readyPlan($: Engine, repo: GitPanelRepo, form: GitPanelForm): Promise<Plan | undefined> {
  const planned = planFrom(repo, form)
  if (!('plan' in planned)) return undefined
  const { branch } = planned.plan
  if (branch.kind !== 'create') return planned.plan
  const branchError = await branchNameError($, repo.root, branch.name)
  if (!branchError) return planned.plan
  await setGitForm($, { branchError })
  return undefined
}

async function chooseRemote($: Engine, repo: GitPanelRepo, plan: Plan): Promise<RemoteSetup | undefined> {
  const decision = remoteDecision(repo, plan)
  if ('setup' in decision) return decision.setup
  const answer = await choose($, decision.question, [...decision.choices.map(choice => choice.label), 'Cancel'])
  return decision.choices.find(choice => choice.label === answer)?.setup
}

async function pushWithPlan($: Engine, repo: GitPanelRepo, form: GitPanelForm): Promise<void> {
  const plan = await readyPlan($, repo, form)
  if (!plan) return
  const setup = await chooseRemote($, repo, plan)
  const question = setup ? confirmationText(plan, repo, setup.remote, form.message) : ''
  if (!setup || (await choose($, question, [plan.label, 'Cancel'])) !== plan.label) {
    await appendGitLog($, { label: 'Cancelled', isOk: true, detail: 'Nothing was changed.' })
    return
  }
  const isPushed = await runSteps($, buildSteps(repo, plan, setup, form.message), repo.root)
  if (isPushed) $.ui.toast(`Pushed to ${setup.repoName} on ${plan.branch.name}`)
  // Visibility is asked again on every run; a pushed form starts clean.
  await update($, gitFormState, current => (isPushed ? { message: '' } : { ...current, visibility: undefined }))
}

/** The primary button: plan, ask, run, then show the repository as it now is. */
async function pushFromPane($: Engine): Promise<void> {
  const snapshot = await read($, gitSnapshotState)
  if (snapshot.kind !== 'repo' || (await read($, gitIsBusyState))) return
  await update($, gitIsBusyState, () => true)
  await update($, gitLogState, () => [])
  try {
    await pushWithPlan($, snapshot, await read($, gitFormState))
    await refreshGit($)
  } finally {
    await update($, gitIsBusyState, () => false)
  }
}

async function initRepository($: Engine, cwd: string): Promise<void> {
  if ((await choose($, `Run git init in ${cwd}?`, ['Initialize', 'Cancel'])) !== 'Initialize') return
  const outcome = await runGit($, ['git', 'init'], cwd)
  await update($, gitLogState, () => [
    { label: 'Initialize repository', isOk: outcome.isOk, detail: outcome.isOk ? 'ok' : outcome.error },
  ])
  await refreshGit($)
}

// ---- Crew ---------------------------------------------------------------------

const CREW_POLL_MS = 2000

async function pollCrew($: Engine): Promise<void> {
  const agents = await $.agent.list()
  const polledAt = await $.clock.now()
  const ids = new Set(agents.map(agent => agent.id))
  // Each view redraws when a value it read is written, so a write that changes nothing is skipped.
  const known = await read($, crewStartedAtState)
  const startedAt = keepListed(known, ids)
  for (const agent of agents) startedAt[agent.id] ??= polledAt
  if (JSON.stringify(startedAt) !== JSON.stringify(known)) await update($, crewStartedAtState, () => startedAt)
  const activity = await read($, crewActivityState)
  const listedActivity = keepListed(activity, ids)
  if (Object.keys(listedActivity).length !== Object.keys(activity).length) {
    await update($, crewActivityState, () => listedActivity)
  }
  // Live agents' elapsed times count from polledAt, so they redraw on every poll.
  const previous = await read($, crewSnapshotState)
  const isSame = JSON.stringify(previous.agents) === JSON.stringify(agents) && !agents.some(isLive)
  if (!isSame) await update($, crewSnapshotState, () => ({ agents, polledAt }))
}

async function refreshCrew($: Engine): Promise<void> {
  try {
    await pollCrew($)
  } catch (error) {
    // The view keeps its last snapshot; the next tick tries again.
    $.ui.log(`dotclaude: could not list agents: ${errorText(error)}`, { to: 'debug' })
  }
}

function startCrewPolling($: Engine): void {
  if (crewPoller !== undefined) return
  crewPoller = $.clock.every(CREW_POLL_MS, () => void refreshCrew($))
}

function stopCrewPolling(): void {
  crewPoller?.cancel()
  crewPoller = undefined
}

async function stopAgent($: Engine, agent: AgentInfo): Promise<void> {
  const name = nameOf(agent)
  if (!(await confirm($, `Stop ${name}?`, 'Stop', 'Stop agent'))) return
  try {
    const stopped = await $.tool.call({ tool: 'TaskStop', task_id: agent.id })
    if (stopped.deny !== undefined) $.ui.toast(`Could not stop ${name}: ${stopped.deny}`)
    else if (stopped.isError === true) $.ui.toast(`Could not stop ${name}: ${stopped.text ?? 'the stop failed'}`)
    else $.ui.toast(`Stopped ${name}`)
  } catch (error) {
    $.ui.toast(`Could not stop ${name}: ${errorText(error)}`)
  }
  await refreshCrew($)
}

async function sendMessage($: Engine, agent: AgentInfo, text: string): Promise<void> {
  const name = nameOf(agent)
  const message = text.trim()
  if (message === '') {
    $.ui.toast(`Type a message for ${name} first`)
    return
  }
  try {
    const sent = await $.session.send({ to: { agentId: agent.id }, text: message })
    if (!sent.isDelivered) {
      $.ui.toast(`Could not send to ${name}: ${sent.reason}`)
      return
    }
  } catch (error) {
    $.ui.toast(`Could not send to ${name}: ${errorText(error)}`)
    return
  }
  $.ui.toast(`Sent to ${name}`)
  await update($, crewComposerState, open => (open?.agentId === agent.id ? { ...open, draft: '' } : open))
}

async function sendDraft($: Engine, agent: AgentInfo): Promise<void> {
  const open = await read($, crewComposerState)
  await sendMessage($, agent, open?.agentId === agent.id ? open.draft : '')
}

function toggleComposer($: Engine, agentId: string): Promise<unknown> {
  return update($, crewComposerState, open => (open?.agentId === agentId ? null : { agentId, draft: '' }))
}

function keepDraft($: Engine, agentId: string, draft: string): Promise<unknown> {
  return update($, crewComposerState, open => (open?.agentId === agentId ? { ...open, draft } : open))
}
