# dotclaude

A workspace for Claude Code in one plugin and one pane, **Workspace**. Plugin panes share a single dock as tabs and a plugin cannot place them, so every feature lives inside this pane, in columns.

## Layout

```
┌──────────── main column ────────────┐  ┌──── side column (when open) ────┐
│ Vitals rail (default)               │  │ Gate | Plan review | Mac |      │
│   or Ledger | Companion | Git | Crew│  │ Notes | Radar                   │
│   in its place, with × Close        │  │ with × Close                    │
└─────────────────────────────────────┘  └─────────────────────────────────┘
```

- The pane opens when every session starts: always on the desktop, and in a terminal from 144 columns (the engine's rule for a pane opened unasked). `/vitals` opens it again.
- **Main column:** the vitals rail. Ledger, Companion, Git and Crew open in its place; their **× Close** brings the vitals back.
- **Side column:** Gate, Plan review, Mac, Notes (the brain) and Radar open beside the main column, one at a time (opening another replaces it), each with its own **× Close**.
- Navigation is `$.state` only (`dotclaude.mainView`, `dotclaude.sideView`): a press switches views at once, runs no slash command and writes nothing to the transcript.
- Every panel starts with a banner: on the desktop an SVG (glyph, title, faint artwork in the panel's colour); in the terminal a coloured `▍Title` line.
- A panel with more than one view has a tab strip under its banner (`hooks/ui/tabs.tsx`): the shown tab is the primary button; switching is `$.state` only.
- Only the main action of a button row is `primary`; labels say what happens, with a glyph (`✓ Approve`, `↻ Refresh`, `× Close`).
- The dock: in the terminal, each panel's coloured glyph before its button. On the desktop, each native button with its panel's badge tile beside it (the desktop's native buttons cannot be coloured, and it draws Markdown images as text, so icon-only buttons are not possible).
- VS Code and mobile get each open view as plain text, without controls.

## Features

- **Vitals rail.** `statusline.sh`'s figures as a bedside monitor: Activity (one heartbeat per tool call), Context (share, tokens, burn per message), Rate limit 5h (share, countdown, 7-day share; hidden without a reading) and Cost (from `$.session.usage()`; hidden without a ledger). The header shows project, branch and dirty dot, model, session age, clock, and chips: `Edits locked` or `Edits open`, `Companion open`, caveman mode, `Context critical`. At 80% context the Context channel turns red and the rail offers **Compact now** (asks first) and **Silence** (10 min). The channels share every spare row of the pane. The dock opens each feature.
- **Gate.** Every session starts brainstorming: `Edit`, `Write`, `NotebookEdit` and `MultiEdit` are refused (the guard denies when it fails, `.catch` pattern). It blocks those four tools only: **Bash, MCP tools and every other tool are not gated**, so it keeps Claude from editing files by mistake, not from acting. Plans and specs stay writable: `.md` files under `docs/plans/`, `specs/`, `docs/superpowers/` or `.claude/plans/`, `.md`, `.html` and `.svg` files under `mockups/`, and any `*.plan.md` or `*.spec.md`, matched on the path relative to the session's project root after `.`, `..` and every symbolic link are resolved, so folders above the project never count. A target that is itself a symbolic link is refused, even one that leads nowhere yet. Your own prompt unlocks when it **starts** with an approval word or phrase (by default `approved`, `go ahead`, `proceed`, `lgtm`, `ship it`, `let's do it`, `sounds good`, and `GO` in capitals), alone or followed by a space or one of `. , ! :` (a word in capitals such as `GO`: alone or followed by one of those marks only): "approved.", "GO" and "GO, do it" unlock; "is it approved?", "approved?", "approved-ish" and "GO away" do not. A lock phrase anywhere locks again (by default `back to brainstorm`, `wait`, `stop`; locking wins). Both lists are options, and the refusal names the words.
- **Plan review.** A successful Write or Edit to a plan path, or ExitPlanMode, records the plan and replaces its tool row with a card: **↗ Review plan**, **◫ Open in companion**. The panel renders the plan (in parts of 30,000 characters), takes an optional comment, and offers **✓ Approve** (unlocks the gate directly) and **✎ Request changes** (sends the comment as your next message).
- **Ledger** (tabs **Edits** and **Requests**). **Edits:** every successful Edit, Write and NotebookEdit: file, lines added and removed, time, and a one-sentence why from Haiku (after the tool result, never slowing it). Appended to `.claude/ledger.md`. Files the approved plan does not mention are flagged. **✎ Draft commit message** (with **⧉ Copy**), **⊕ Save to brain** (opens the brain beside and starts its scribe), **⇢ Timeline** (an HTML timeline shown in the companion).
  **Requests:** one row per model request of the main loop (time, model, tokens in and out, real cost, tool calls, duration). The cost is the rise in the session's own cost total (`$.session.usage().cost`) read just before and just after the request, never a price table; it reads `—` where the host keeps no cost ledger. Tool calls go to the request that asked for them (the engine runs a response's calls before the next request). **Details ›** opens a request's tools (✓/✗, duration) and its token breakdown; **← Requests** goes back. Kept for the session only, not written to `ledger.md`.
- **Companion.** The plugin's own small server (`assets/server.py`, Python standard library) serves `<claude dir>/companion/` on `127.0.0.1` (port 4747 by default). It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise, against DNS rebinding), serves regular files inside that folder only (no traversal, no listing, links resolved), and sends `X-Content-Type-Options: nosniff` and a Content-Security-Policy (`default-src 'self' 'unsafe-inline' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts` for views; the shell page alone may connect to the server, to poll its manifest and fetch the views it shows). A path that names no file (a NUL byte, an over-long name) answers 404. The server's token is kept in `<claude dir>/companion.token` (mode 0600, outside the served folder): a server on the port is trusted only when it answers that token at `/__token`; one an earlier session left running is stopped (`POST /__shutdown` with the token in a header) and replaced; an older companion with another token, or another program, gets a message naming how to free the port. Views are shown in a sandboxed frame (`sandbox="allow-scripts"`, no same origin) through `srcdoc`, under a policy that adds `connect-src 'none'` (embedding browsers such as the desktop's preview pane block framed page loads): **`/companion show file.html` runs that page's scripts inside the sandbox**, where they cannot read the shell or make background network requests (a link the person clicks still navigates the frame). `/companion show` takes `.html` and `.md` files inside the project only, and refuses a file that is itself a symbolic link or resolves outside the project. The page opens in the desktop's browser pane (`$.mcp.call` to `Claude_Browser`'s `preview_start`; elsewhere Claude is asked to open it and the URL is toasted). While open, a system prompt section tells Claude to put visual answers there, and two `tool.call` hooks add files to it: every file passed to `SendUserFile` (any folder; `.html` as is, `.svg`, `.md`, `.csv`, `.json` drawn, other kinds as a card with the path), and every *new* `.html`, `.svg`, `.md`, `.csv` or `.json` file written by `Write` inside the project or the session's scratchpad (`/tmp/claude-*/<project>/<session id>/scratchpad/`, matched because the engine does not name it; symbolic links refused). Edits to existing files are not shown.
- **Mac.** CPU, memory, disk and battery sparklines (every 5 s, only while the panel shows), the heaviest processes with **■ End process…** (asks, then SIGTERM), Docker containers with **■ Stop…** (asks) and **≡ Logs**.
- **Notes (brain).** Live view of your notes vault (`~/Notes` by default: search, inbox, today's daily note, recent notes; every 10 s while shown; a plain message when the folder does not exist). **+ Capture this session** runs the `dotclaude:scribe` agent (hidden from the main model); its questions are asked in dialogs; before anything is written each proposed note is shown in full (path and body, a long body cut at 40 lines with "+N more lines") with the daily line, and saved only on **Save**; a note holding code blocks is flagged, and Obsidian's runnable parts are made inert before writing (a `dataviewjs` block becomes a `text` block, an inline `` `$= `` query is escaped, a Templater `<%` becomes `&lt;%`); titles, tags and the daily line are held to one line; paths stay in the note folders, never in a hidden folder (`.obsidian`), and no folder or file on the way may be a symbolic link; notes are never overwritten, an existing one gets a dated section. The scribe follows `<claude dir>/skills/<conventionsSkill>/SKILL.md` when that skill is installed, else built-in conventions (frontmatter, wikilinks, a daily note).
- **Radar** (tabs **Ideas** and **Advisor**). **Ideas:** **⌕ Scan now** reads your recent prompts (`<claude dir>/projects`) and vault titles and asks Sonnet for skills, mods and agents you lack; each card has **✎ Draft** (a brainstorm prompt that asks you where to create it), **◷ Later**, **× Dismiss**. Kept in the plugin's store.
  **Advisor:** **⌕ Scan catalogs** reads the catalogs of your marketplaces (`<claude dir>/plugins/marketplaces/*`, fetched fresh from GitHub when they live there) plus well-known ones not added yet (`anthropics/claude-plugins-official`, `anthropics/skills`), leaves out what is installed, enabled or hidden, and asks Sonnet for 5 to 8 picks for your recent prompts; picks the catalogs do not list are dropped, as are catalog entries whose plugin, marketplace or repository name is not a plain name (URLs and install lines are built from checked parts only). Cards show an initial tile, name, author, description and why, with **⧉ Copy install** (the `/plugin marketplace add` line too when needed) and **× Hide** (for good). Offline, the local catalogs are used and the panel says so. The last results are kept in the plugin's store.
- **Git.** Status, changes (every file, inside untracked folders too: `git status --porcelain -uall`), repository and branch pickers, and one primary button (`↑ Push`, `↑ Commit and push`, …) that asks first in one confirmation listing the files a commit takes (the first 15), warning about names that look like secrets (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*.p12`, `credentials*`) and about a public repository, and showing the commit message; the panel never builds a force push, runs git with `core.fsmonitor` off, puts `--` before names where git and gh take it, accepts only plain repository and remote names, adds the Co-Authored-By line, and undoes what it can when a step fails. The commit message is drafted by the ledger while the field is empty.
- **Crew.** The session's agents: why each runs, what it does now, **■ Stop…** (asks, then TaskStop) and **✉ Message** (sent with `$.session.send`).

## What runs automatically

- **Every 5 s, from session start:** the vitals read the git branch and dirty state (`git status`) of the project, and the caveman flag file.
- **After each successful Edit, Write or NotebookEdit:** one Haiku call writes the ledger's why, then a line is appended to the project's `.claude/ledger.md`.
- **When the Git panel opens:** `gh auth status` and `gh repo list`, and a Haiku call drafting the commit message from the ledger while the field is empty.
- **Companion server:** started only when you open the companion (or a session reload finds it was open).
- **Only on a click:** Radar's scan, the Advisor's scan, the brain's capture, and every Git push.

## What is sent to the model

Every text below goes through `redactSecrets` first (`hooks/redact.ts`): API keys (`sk-…`, `sk-ant-…`, Stripe `sk_live_…`/`rk_test_…`, Google `AIza…`), AWS key ids and secret access keys (after `aws_secret_access_key`), GitHub, Slack, npm (`npm_…`) and Hugging Face (`hf_…`) tokens, `Bearer` tokens and `Authorization:` header values, the password of a `user:password@` URL, the value of environment lines whose name holds `KEY`, `SECRET`, `TOKEN` or `PASSWORD` (`API_KEY=…`), private key blocks and JSON Web Tokens are replaced by `[redacted secret]` (a label such as `API_KEY=` stays).

| Feature | When | Model | What is sent |
|---|---|---|---|
| Ledger, why | After each successful edit | Haiku | Claude's latest message (up to 4,000 characters) and the change (up to 1,500 characters of old and new text) |
| Ledger, commit message | Draft commit message, or the Git panel opening with changes | Haiku | The session's ledger entries (file, lines, why) |
| Brain, scribe | + Capture this session | Sonnet (scribe agent, or one model call when agents are off) | The session's messages (the last 60,000 characters), your note conventions, the vault's note list, what you asked to capture, and your answers to its questions |
| Radar, Ideas | ⌕ Scan now | Sonnet | Up to 4 of your prompts from each of your 40 newest sessions (300 characters each), your vault's note titles, what you have installed, dismissed ideas |
| Radar, Advisor | ⌕ Scan catalogs | Sonnet | Plugin catalog entries (name, author, description), the same recent prompts, what you have installed |

## Commands

| Command | Opens |
|---|---|
| `/vitals` | the workspace on the vitals rail (keeps the side panel) |
| `/gate [approve\|lock]` | Gate; `approve` and `lock` change the phase |
| `/plan-review` | Plan review, or says there is no plan yet |
| `/ledger [commit-message]` | Ledger; `commit-message` answers a drafted message |
| `/mac` | Mac |
| `/brain [capture [text]]` | Notes; `capture` starts the scribe |
| `/radar` | Radar |
| `/companion [show <absolute path>]` | Companion, opening the companion if closed |
| `/git-panel` | Git |
| `/crew` | Crew (`/agents` is a Claude Code built-in name) |

## Options

Set them in `/config`, or in `settings.json` under `pluginConfigs["dotclaude@dotclaude"].options` when installed from the marketplace (`pluginConfigs.dotclaude` under `--plugin-dir` or a dev folder). An unset option uses its default; installing with `--config key=value` for each saves the defaults as visible values.

| Option | Default | What it does |
|---|---|---|
| `vaultPath` | `~/Notes` | Your notes vault; `~` is your home folder, absolute paths work too |
| `vaultName` | `Notes` | The vault's name in Obsidian, for `obsidian://` links |
| `conventionsSkill` | `notes-conventions` | A skill under `<claude dir>/skills/` whose `SKILL.md` holds your vault's note conventions; without it the scribe uses built-in ones |
| `approvalWords` | `approved, go ahead, proceed, lgtm, ship it, let's do it, sounds good, GO` | Comma-separated; whole words, any case, except a word in capitals matches only in capitals |
| `lockPhrases` | `back to brainstorm, wait, stop` | Comma-separated; lock edits again |
| `companionPort` | `4747` | The companion's port on 127.0.0.1 |

`<claude dir>` is `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.

## Desktop traces: one switch

`hooks/features/vitals/svg.ts` starts with `VITALS_TRACE_MODE`:

- `'smil'` (default): each channel's SVG animates its own sweep with SMIL (the head glides, the newest ink is revealed behind it, the erase gap moves) for 8 s, and is rebuilt only when its data changes or every 5 s. Chromium runs SMIL in an SVG drawn as an image, so no interactive frame is used (that one reloads and flashes on each redraw).
- `'redraw'`: a static, lighter SVG (half the samples, no glow) redrawn every 250 ms.

The desktop's cell size in pixels is not given by any API; `DESKTOP_CELL` in `hooks/ui/tokens.ts` holds the estimate used to size the SVGs.

## Code layout

- `hooks/register.tsx`: every hook, every `$` call and every `$.state` atom (the validator follows `$` and atoms within this file only).
- `hooks/features/<feature>/`: pure code: `view.tsx` (values and callbacks in, tree out) and the feature's logic modules.
- `hooks/ui/`: shared design primitives: tokens, the banner, panel and button-row chrome.
- `hooks/config.ts`: the options, parsed with their defaults.
- `types/index.d.ts`: every state value, under `PluginState['dotclaude']`.

## Develop

Load it from its folder (`claude --plugin-dir <this folder>`), then:

```
claude plugin validate .
claude plugin test .
```
