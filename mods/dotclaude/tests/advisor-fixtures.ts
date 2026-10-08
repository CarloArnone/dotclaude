// Catalogs shaped like the real marketplace files: `.claude-plugin/marketplace.json` with
// `owner` and per-plugin `author` objects (or none), and the `.agents/plugins/marketplace.json`
// layout with no descriptions. Names and people are made up.

export const OFFICIAL_CATALOG = JSON.stringify({
  $schema: 'https://example.com/marketplace.schema.json',
  name: 'official-plugins',
  description: 'Plugins reviewed by the editor.',
  owner: { name: 'Editor Team', email: 'team@example.com' },
  renames: { old: 'new' },
  plugins: [
    {
      name: 'api-security',
      description: 'Audit OpenAPI specs and fix what it finds.',
      author: { name: 'Shield Co' },
      category: 'security',
      source: { source: 'git-subdir', url: 'https://github.com/shield/plugins.git', path: 'api' },
    },
    { name: 'release-helper', description: 'Draft release notes and changelogs from commits.', category: 'productivity', source: './plugins/release-helper' },
    { name: 'tdd-coach', description: 'Red, green, refactor, one test at a time.', author: { name: 'Pat Doe' }, keywords: ['tests', 'tdd'], source: './plugins/tdd' },
    { description: 'A plugin with no name is skipped.' },
  ],
})

export const SINGLE_CATALOG = JSON.stringify({
  name: 'terse',
  description: 'Shorter answers.',
  owner: { name: 'Sam Roe' },
  plugins: [{ name: 'terse', description: 'Talk in fewer words.', source: './', category: 'productivity' }],
})

export const AGENTS_LAYOUT_CATALOG = JSON.stringify({
  name: 'toolkit',
  interface: { displayName: 'Toolkit' },
  plugins: [{ name: 'toolkit', version: '2.0.0', source: { source: 'local', path: './plugins/toolkit' }, category: 'Productivity' }],
})

export const WELL_KNOWN_CATALOG = JSON.stringify({
  name: 'agent-skills',
  owner: { name: 'Skills Team' },
  plugins: [{ name: 'document-skills', description: 'Read and write spreadsheets, slides and documents.', source: './' }],
})

/** The model picking from the catalogs: two real picks, one invented, one repeated, one malformed. */
export const PICKS_REPLY = [
  'Here are my picks:',
  '```json',
  JSON.stringify({
    picks: [
      { name: 'release-helper', marketplace: 'official', why: 'You wrote release notes by hand twice this week.' },
      { name: 'made-up-plugin', marketplace: 'official', why: 'Invented.' },
      { name: 'document-skills', marketplace: 'agent-skills', why: 'You asked for a spreadsheet summary.' },
      { name: 'release-helper', marketplace: 'official', why: 'Repeated.' },
      { name: 42 },
    ],
  }),
  '```',
].join('\n')
