// The ledger's Requests tab: one record per model request. Pure: no `$`.

import type { ModelUsage } from 'claude-code'

import type { RequestRecord } from '../../../types'
import { COLORS } from '../../ui/tokens'

/** Requests kept for the session: the newest, enough for any turn worth reading. */
export const REQUESTS_KEPT = 200

export const NO_COST_REASON = 'This host keeps no cost ledger, so request costs are not shown.'

export function requestTokens(usage: ModelUsage): RequestRecord['tokens'] {
  return {
    input: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
  }
}

/** What the session's cost rose by across a request; null when either reading is missing. */
export function costDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null
  return Math.max(0, after - before)
}

/**
 * The request a tool call belongs to. The engine runs a response's tool calls after the
 * response and before the next request, so the call is the newest request's, provided
 * that response asked for one more call of that tool; otherwise it is no request's (a
 * plugin's own `$.tool.call`, say).
 */
export function requestForTool(requests: readonly RequestRecord[], tool: string): string | undefined {
  const newest = requests.at(-1)
  if (newest === undefined) return undefined
  const asked = newest.expectedTools.filter(name => name === tool).length
  const taken = newest.tools.filter(call => call.tool === tool).length
  return taken < asked ? newest.id : undefined
}

/** The newest turn's requests and what they cost; cost null when any of them has none. */
export function currentTurn(requests: readonly RequestRecord[]): { count: number; costUsd: number | null } {
  const turnId = requests.at(-1)?.turnId
  const inTurn = requests.filter(request => request.turnId === turnId)
  const isPriced = inTurn.every(request => request.costUsd !== null)
  return {
    count: inTurn.length,
    costUsd: isPriced ? inTurn.reduce((sum, request) => sum + (request.costUsd ?? 0), 0) : null,
  }
}

export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '…'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

/** A model id as a row has room for: without the `claude-` lead. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '')
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other'

export function modelFamily(model: string): ModelFamily {
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  if (/haiku/i.test(model)) return 'haiku'
  return 'other'
}

/** Each model family's tile colour, from the suite's palette. */
export const FAMILY_COLORS: Record<ModelFamily, string> = {
  opus: COLORS.lock,
  sonnet: COLORS.spo2,
  haiku: COLORS.ecg,
  other: COLORS.resp,
}

/** The tile's letter: the family's initial, or the model's own for another family. */
export function modelInitial(model: string): string {
  const family = modelFamily(model)
  const name = family === 'other' ? shortModel(model) : family
  return (/[a-z0-9]/i.exec(name)?.[0] ?? '?').toUpperCase()
}

/** The request that cost the session most, when any has a cost; the first of equals. */
export function topRequestId(requests: readonly RequestRecord[]): string | undefined {
  let top: RequestRecord | undefined
  for (const request of requests) {
    if (request.costUsd !== null && request.costUsd > 0 && (top === undefined || request.costUsd > (top.costUsd ?? 0))) top = request
  }
  return top?.id
}

/** "3 tools · 4.2 s", with " · ✗ 1 failed" when any call failed. */
export function requestSubtitle(request: RequestRecord): string {
  const tools = request.tools.length === 1 ? '1 tool' : `${request.tools.length} tools`
  const failed = request.tools.filter(call => call.isOk === false).length
  return [tools, formatDuration(request.durationMs), ...(failed > 0 ? [`✗ ${failed} failed`] : [])].join(' · ')
}

/** "in 6.2k (cache 5.2k) · out 300". */
export function requestTokensLine(request: RequestRecord): string {
  const { tokens } = request
  return `in ${formatCount(tokens.input)} (cache ${formatCount(tokens.cacheRead + tokens.cacheWrite)}) · out ${formatCount(tokens.output)}`
}
