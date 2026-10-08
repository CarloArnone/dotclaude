// Masks the secrets a text may carry before it is sent to a model. Pure: no `$`.

// Each match is a secret as a whole.
const SECRET_PATTERNS: readonly RegExp[] = [
  // Private keys, whole blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Anthropic and OpenAI style keys (sk-ant-…, sk-proj-…, sk-…).
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  // Stripe secret and restricted keys.
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  // Google API keys.
  /AIza[0-9A-Za-z_-]{35}/g,
  // AWS access key ids.
  /AKIA[0-9A-Z]{16}/g,
  // GitHub tokens: classic (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained.
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  // npm and Hugging Face access tokens.
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  // Slack tokens.
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  // JSON Web Tokens: three base64url parts, the first a JSON header.
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]

// The first group is a label that stays, so the model still sees what was there; the rest of
// the match is the secret.
const LABELLED_PATTERNS: readonly RegExp[] = [
  // An Authorization header's whole value, whatever its scheme.
  /(\bAuthorization\s*:\s*)[^\r\n]+/gi,
  // A bearer token anywhere else; long enough not to be a word of prose.
  /(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  // The password of a URL's user:password@.
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi,
  // AWS secret access keys, as the credentials file and the environment name them.
  /(\baws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}/gi,
  // Environment lines whose name says key, secret, token or password: API_KEY=…, export DB_PASSWORD="…".
  /^(\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*)\S.*$/gm,
]

export const REDACTED = '[redacted secret]'

/** `text` with every API key, token, password and private key it holds replaced by a marker. */
export function redactSecrets(text: string): string {
  const labelled = LABELLED_PATTERNS.reduce((masked, pattern) => masked.replace(pattern, `$1${REDACTED}`), text)
  return SECRET_PATTERNS.reduce((masked, pattern) => masked.replace(pattern, REDACTED), labelled)
}
