import { describe, expect, test } from 'claude-code/testing'

import { REDACTED, redactSecrets } from '../hooks/redact'

// Fake secrets built at run time, so no literal key-shaped string sits in the source.
const fill = (length: number, char = 'a') => char.repeat(length)
export const FAKE = {
  openai: `sk-proj-${fill(24)}`,
  anthropic: `sk-ant-api03-${fill(24, 'B')}`,
  aws: `AKIA${fill(16, 'Q')}`,
  github: `ghp_${fill(30, 'x')}`,
  githubFine: `github_pat_${fill(30, 'y')}`,
  slack: `xoxb-${fill(12, '1')}-${fill(12, '2')}`,
  jwt: `eyJ${fill(12, 'h')}.eyJ${fill(12, 'p')}.${fill(16, 's')}`,
  privateKey: `-----BEGIN RSA PRIVATE KEY-----\n${fill(40, 'M')}\n-----END RSA PRIVATE KEY-----`,
  stripeLive: `${'sk'}_live_${fill(24, 'S')}`,
  stripeRestricted: `${'rk'}_test_${fill(24, 'R')}`,
  google: `AIza${fill(35, 'G')}`,
  npm: `npm_${fill(36, 'n')}`,
  huggingFace: `hf_${fill(34, 'f')}`,
}

// Secrets that keep their label: [the text holding the secret, what the model sees instead].
const LABELLED: Record<string, [string, string]> = {
  'an Authorization header': [`Authorization: Basic ${fill(20, 'b')}`, `Authorization: ${REDACTED}`],
  'a bearer token': [`curl -H "x: Bearer ${fill(32, 't')}"`, `curl -H "x: Bearer ${REDACTED}"`],
  'a URL password': [`postgres://admin:${fill(12, 'p')}@db.example.com/app`, `postgres://admin:${REDACTED}@db.example.com/app`],
  'an AWS secret access key': [`aws_secret_access_key = ${fill(40, 'W')}`, `aws_secret_access_key = ${REDACTED}`],
  'an env line naming a key': [`API_KEY=${fill(10, 'k')}`, `API_KEY=${REDACTED}`],
  'an exported password': [`export DB_PASSWORD="${fill(10, 'w')}"`, `export DB_PASSWORD=${REDACTED}`],
  'a secret among other lines': [`PORT=3000\nSESSION_SECRET=${fill(8, 'z')}\nDEBUG=1`, `PORT=3000\nSESSION_SECRET=${REDACTED}\nDEBUG=1`],
}

describe('redactSecrets', () => {
  for (const [kind, secret] of Object.entries(FAKE)) {
    test(`masks ${kind}`, () => {
      const masked = redactSecrets(`before ${secret} after`)
      expect(masked).toBe(`before ${REDACTED} after`)
    })
  }

  for (const [kind, [text, masked]] of Object.entries(LABELLED)) {
    test(`masks ${kind}, keeping its label`, () => {
      expect(redactSecrets(text)).toBe(masked)
    })
  }

  test('leaves ordinary text alone', () => {
    const text = 'Use sk-short, ask the team, run eyJ.a.b and see AKIA123 in the docs.'
    expect(redactSecrets(text)).toBe(text)
  })

  test('leaves prose and code that only name these things alone', () => {
    const text = [
      'Send a Bearer token in the header.',
      'See https://example.com/docs and git@github.com:octocat/app.git',
      'const tokenCount = 5',
      'PORT=3000',
    ].join('\n')
    expect(redactSecrets(text)).toBe(text)
  })

  test('masks every secret of a text, not just the first', () => {
    expect(redactSecrets(`${FAKE.github} and ${FAKE.aws}`)).toBe(`${REDACTED} and ${REDACTED}`)
  })
})
