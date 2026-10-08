// Rows shaped like ~/.claude/projects/*/*.jsonl, one of each kind seen there.
const ROWS: readonly unknown[] = [
  { type: 'permission-mode', permissionMode: 'default' },
  {
    type: 'user',
    origin: { kind: 'human' },
    cwd: '/Users/user/Projects/demo-app',
    timestamp: '2026-10-03T09:12:00.000Z',
    message: { role: 'user', content: 'Write release notes for version 2.3' },
  },
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Here are the release notes.' }] },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  },
  {
    type: 'user',
    isMeta: true,
    message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /tmp/x' }] },
  },
  {
    type: 'user',
    origin: { kind: 'task-notification' },
    message: { role: 'user', content: '<task-notification> <task-id>b6</task-id>' },
  },
  {
    type: 'user',
    message: { role: 'user', content: 'Below is a conversation log from a Claude Code coding session.' },
  },
  {
    type: 'user',
    message: { role: 'user', content: '<command-name>/plugin</command-name>' },
  },
  {
    type: 'user',
    origin: { kind: 'human' },
    cwd: '/Users/user/Projects/demo-app',
    timestamp: '2026-10-03T09:30:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Now   a changelog\nentry' }] },
  },
]

// A tail read starts mid-row; the first line is a fragment.
export const TRANSCRIPT = ['"content":"cut mid-row"}}', ...ROWS.map(row => JSON.stringify(row))].join('\n')

export const MODEL_REPLY = [
  'Here is what I found:',
  '```json',
  JSON.stringify({
    skills: [
      {
        id: 'release-notes',
        title: 'Release notes drafting',
        evidence: 'Release notes on 2026-10-03 and a changelog entry the same day.',
        pitch: 'Drafts release notes and the changelog from the merged commits.',
      },
      { id: 'plan-gate', title: 'Plan gate', evidence: 'x', pitch: 'y' },
      { id: 'old-idea', title: 'Old idea', evidence: 'x', pitch: 'y' },
    ],
    mods: [{ id: 'quick-deploy', title: 'One-click deploy', evidence: 'deploy by hand.', pitch: 'A button.' }],
    agents: [{ title: 'Build log reader', evidence: 'CI logs pasted.', pitch: 'Reads them.' }],
  }),
  '```',
].join('\n')
