# Installing dotclaude

Instructions for Claude (or a person) to install the plugin. This repository's root
`.claude-plugin/marketplace.json` makes it the marketplace `dotclaude`, with one plugin, `dotclaude`
(`mods/dotclaude/`). Everything ships as one plugin because plugin panes cannot be placed side by side:
one plugin draws every feature in a single Workspace pane.

## Steps

Run these at the prompt of an interactive **terminal** `claude` session (the desktop Code tab does not
offer `/plugin install`; a plugin installed at the user scope loads there too).

1. Add the marketplace once:

   ```
   /plugin marketplace add CarloArnone/dotclaude
   ```

2. Install the plugin, choosing the **user** scope when asked:

   ```
   /plugin install dotclaude@dotclaude
   ```

   Shell form (non-interactive), saving every default as a visible value that can be changed later
   in `/config` or with `/plugin configure dotclaude@dotclaude`:

   ```bash
   claude plugin install dotclaude@dotclaude --scope user \
     --config 'vaultPath=~/Notes' \
     --config 'vaultName=Notes' \
     --config 'conventionsSkill=notes-conventions' \
     --config "approvalWords=approved, go ahead, proceed, lgtm, ship it, let's do it, sounds good, GO" \
     --config 'lockPhrases=back to brainstorm, wait, stop' \
     --config 'companionPort=4747'
   ```

   Options left unset use their defaults, so the plugin works either way.

3. Restart Claude Code (or run `/reload-plugins`). The Workspace pane opens on every session start;
   `/vitals` reopens it.

4. Optional: set your options in `/config` (notes vault and its name, conventions skill, approval words,
   lock phrases, companion port),
   or in `~/.claude/settings.json`:

   ```json
   {
     "pluginConfigs": {
       "dotclaude@dotclaude": {
         "options": { "vaultPath": "~/Notes", "vaultName": "Notes" }
       }
     }
   }
   ```

To update later: `claude plugin marketplace update dotclaude`, then `/reload-plugins`.

## Requirements

- Claude Code with function-hook plugins (mods).
- macOS for the Mac panel (it reads `top`, `memory_pressure`, `pmset`, `df`).
- `git`; the GitHub CLI `gh`, signed in (`gh auth login`), for the Git panel's repo list and new repos.
- `python3` for the companion's local server (127.0.0.1, port 4747 by default).
- A folder of Markdown notes (an Obsidian vault works) for the notes panel and radar.
- Docker is optional: the Mac panel hides its section without it.

## Develop

From this repository's root:

```
claude plugin validate .
claude plugin validate mods/dotclaude
claude plugin test mods/dotclaude
```

`mods/mockup.html` is the interactive design reference, with sample data.
