// ---- Navigation ---------------------------------------------------------------

/** What the main column shows: the vitals rail, or one feature in its place. */
export type MainView = 'vitals' | 'ledger' | 'companion' | 'git' | 'crew'

/** What the side column shows beside the main column; null while it is closed. */
export type SideView = 'gate' | 'plan' | 'mac' | 'brain' | 'radar'

// ---- Vitals -------------------------------------------------------------------

/** One reading of a slow channel, taken when the session was measured. */
export type HudPoint = { at: number; value: number }

/** The readings each slow channel's trace is drawn from, oldest first. */
export type HudSeries = { context: HudPoint[]; rate: HudPoint[]; cost: HudPoint[] }

export type HudHeader = {
  project: string
  branch: string | null
  isDirty: boolean
  model: string
  startedAt: number
}

export type HudContext = { percent: number; tokens: number; window: number }

export type HudRateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type HudLastCall = { inputTokens: number; outputTokens: number }

// ---- Gate ---------------------------------------------------------------------

export type GatePhase = 'brainstorm' | 'approved'

// ---- Plan review --------------------------------------------------------------

export type PlanReviewStatus = 'pending' | 'approved' | 'changes'

export type PlanReviewPlan = {
  /** Absolute path of the plan file; null for a plan-mode plan never saved. */
  planPath: string | null
  status: PlanReviewStatus
  /** File name shown on the card and in the request-changes message. */
  name: string
  text: string
  sections: number
  /** The tool row that drew the card. */
  toolUseId: string
}

// ---- Ledger -------------------------------------------------------------------

/** One recorded change: what was touched, by how much, and why. */
export type LedgerEntry = {
  /** The tool_use_id of the call that made the change. */
  id: string
  /** Local time of the change, HH:MM. */
  time: string
  /** Path relative to the project root (absolute when outside it). */
  file: string
  added: number
  removed: number
  /** One past-tense sentence; null while the model is still answering. */
  why: string | null
  /** True when an approved plan exists and does not mention the file. */
  isOutsidePlan: boolean
}

/** The commit message drafted from the session's entries. */
export type LedgerDraft =
  | { status: 'idle' }
  | { status: 'drafting' }
  | { status: 'ready'; text: string }
  | { status: 'failed'; reason: string }

export type LedgerTab = 'edits' | 'requests'

/** One tool call a model request asked for, as it ran. */
export type RequestTool = {
  /** The tool_use_id of the call. */
  id: string
  tool: string
  /** The tool and what it worked on, shortened ("Bash npm test"). */
  summary: string
  /** Null while it runs. */
  isOk: boolean | null
  durationMs: number | null
}

/** One model request of the session's main loop: a `turn.step` that got a response. */
export type RequestRecord = {
  /** `<turnId>:<index>`. */
  id: string
  turnId: string
  index: number
  /** When the request started, in `$.clock.now()` milliseconds. */
  at: number
  model: string
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** What the session's cost rose by across the request; null where the host keeps no cost ledger. */
  costUsd: number | null
  durationMs: number
  /** The tool names the response asked for, in order: the calls that follow are matched to them. */
  expectedTools: string[]
  tools: RequestTool[]
}

// ---- Companion ----------------------------------------------------------------

export type CompanionView = { slug: string; title: string; createdAt: number }

// ---- Mac ----------------------------------------------------------------------

export type Meter = 'cpu' | 'memory' | 'disk' | 'battery'

export type Battery = { percent: number; isCharging: boolean }

export type Process = { pid: number; cpu: number; name: string }

export type Container = { name: string; status: string }

/**
 * What the last sample saw. A field is absent when its command failed, so
 * the view hides that row; history keeps the readings that did arrive.
 */
export type Snapshot = {
  latest: Partial<Record<Meter, number>>
  history: Record<Meter, number[]>
  isCharging: boolean
  thermal?: string
  processes?: Process[]
  containers?: Container[]
}

export type ContainerLogs = { name: string; text: string }

// ---- Brain --------------------------------------------------------------------

/** One note of the vault, by its path relative to the vault root. */
export type NoteRef = { path: string; mtimeMs: number }

/** What the live view shows; null until the first refresh. */
export type VaultView = {
  vaultName: string
  /** The vault's folder when it does not exist: the view says so instead of listing notes. */
  missingPath: string | null
  inbox: NoteRef[]
  recent: NoteRef[]
  today: { path: string; exists: boolean; captures: number }
}

export type SearchResult = { query: string; hits: string[] }

export type ScribeNote = { path: string; title: string; tags: string[]; body: string }
export type ScribeQuestion = { id: string; question: string; options: string[] }
export type ScribeAnswer = {
  notes: ScribeNote[]
  dailyLine: string
  questions: ScribeQuestion[]
}

/** The capture state machine the view draws. */
export type CaptureState =
  | { phase: 'idle' }
  | { phase: 'working'; stage: 'draft' | 'final'; agentId: string; draftPrompt: string }
  | { phase: 'question'; question: ScribeQuestion; position: number; total: number }
  | { phase: 'saved'; paths: string[] }
  | { phase: 'failed'; reason: string }

// ---- Radar --------------------------------------------------------------------

export type RadarKind = 'skill' | 'mod' | 'agent'

export type RadarIdea = {
  id: string
  kind: RadarKind
  title: string
  evidence: string
  pitch: string
}

export type RadarScan = {
  scannedAt: number
  sessionCount: number
  ideas: RadarIdea[]
}

export type RadarStatus = { isScanning: boolean; error: string | null }

export type RadarTab = 'ideas' | 'advisor'

/** One plugin the advisor suggests, with what is needed to install it. */
export type AdvisorPick = {
  name: string
  marketplace: string
  author: string
  description: string
  why: string
  /** The marketplace's GitHub repo (`owner/repo`), when known. */
  repo: string | null
  /** Whether the marketplace is already added on this machine. */
  isAdded: boolean
}

export type AdvisorResult = {
  scannedAt: number
  /** How many catalogs the scan read. */
  catalogCount: number
  picks: AdvisorPick[]
  /** A plain note about the scan, such as GitHub being unreachable; null when all went well. */
  note: string | null
}

// ---- Git ----------------------------------------------------------------------

export type GitPanelRemote = { name: string; url: string }

export type GitPanelGitHubRepo = { nameWithOwner: string; isPrivate: boolean; url: string }

/** Whether `gh` can list your repos, and why not when it cannot. */
export type GitPanelGitHub =
  | { isAvailable: true; repos: GitPanelGitHubRepo[] }
  | { isAvailable: false; reason: string }

export type GitPanelRepo = {
  kind: 'repo'
  root: string
  folderName: string
  /** Empty on a detached HEAD. */
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  /** `git status --porcelain` lines, as printed. */
  files: string[]
  branches: string[]
  remotes: GitPanelRemote[]
  github: GitPanelGitHub
}

export type GitPanelSnapshot =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-repo'; cwd: string }
  | GitPanelRepo

export type GitPanelForm = {
  /** A repo option value; undefined until picked or preselected. */
  repo?: string
  newRepoName?: string
  /** Undefined until picked: never chosen silently. */
  visibility?: 'private' | 'public'
  branch?: string
  newBranchName?: string
  branchError?: string
  message: string
  /** Why the ledger could not draft a message, when it could not. */
  ledgerNote?: string
}

export type GitPanelStep = { label: string; isOk: boolean; detail: string }

// ---- Crew ---------------------------------------------------------------------

export type CrewComposer = { agentId: string; draft: string }

declare module 'claude-code' {
  interface PluginState {
    dotclaude: {
      mainView: MainView
      sideView: SideView | null

      /** The 1 s tick (250 ms in the redraw fallback): the terminal's sweep and clocks read it. */
      now: number
      /** The desktop's slow tick: its drawing redraws on it (and on new data), never on the 1 s tick. */
      desktopTick: number
      header: HudHeader
      context: HudContext
      /** The last six context percentages, for the burn rate. */
      contextHistory: number[]
      rateLimits: HudRateLimit[]
      /** Null where the host keeps no cost ledger. */
      costUsd: number | null
      lastCall: HudLastCall | null
      series: HudSeries
      /** Tool call timestamps still inside the trace window. */
      calls: number[]
      callCount: number
      /** Null while ~/.claude/.caveman-active is missing or invalid. */
      caveman: string | null
      silencedUntil: number

      gatePhase: GatePhase

      plan: PlanReviewPlan | null
      planComment: string
      planPart: number

      ledgerEntries: LedgerEntry[]
      ledgerDraft: LedgerDraft
      ledgerTab: LedgerTab
      ledgerRequests: RequestRecord[]
      /** The request whose overview is open in the Requests tab; null shows the list. */
      ledgerRequestOpen: string | null

      companionIsOpen: boolean
      /** This session's secret for its companion server, answered at /__token; '' until first needed. */
      companionToken: string

      macSnapshot: Snapshot
      macLogs: ContainerLogs | null

      brainView: VaultView | null
      brainSearch: SearchResult
      brainCapture: CaptureState

      radarStatus: RadarStatus
      radarLastScan: RadarScan | null
      radarLater: RadarIdea[]
      radarTab: RadarTab
      advisorStatus: RadarStatus
      advisorResult: AdvisorResult | null

      gitSnapshot: GitPanelSnapshot
      gitForm: GitPanelForm
      gitLog: GitPanelStep[]
      gitIsBusy: boolean

      crewSnapshot: { agents: AgentInfo[]; polledAt: number }
      /** Agent id -> its latest tool call, as drawn ("Write hooks/register.tsx"). */
      crewActivity: Record<string, string>
      /** Agent id -> when it was spawned, or first seen when the spawn predates this module. */
      crewStartedAt: Record<string, number>
      crewComposer: CrewComposer | null
    }
  }
}
