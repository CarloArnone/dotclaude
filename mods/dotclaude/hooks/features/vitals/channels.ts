import { COLORS } from '../../ui/tokens'
import type { HudContext, HudLastCall, HudRateLimit, HudSeries } from '../../../types'
import {
  burnPercent,
  callsPerMinute,
  findLimit,
  formatCountdown,
  formatTokens,
  formatUsd,
} from './readings'
import { ACTIVITY_SAMPLE_MS, activityAt, SLOW_SAMPLE_MS, stepAt } from './trace'

/** What the rail draws from: every value a drawing reads from `$.state`. */
export type Readings = {
  now: number
  context: HudContext
  contextHistory: number[]
  rateLimits: HudRateLimit[]
  costUsd: number | null
  lastCall: HudLastCall | null
  series: HudSeries
  calls: number[]
  callCount: number
}

export type Channel = {
  id: 'activity' | 'context' | 'rate' | 'cost'
  label: string
  color: string
  value: string
  unit: string
  footLeft: string
  footRight: string
  /** The trace's sample spacing, and its value at any time. */
  sampleMs: number
  valueAt: (t: number) => number
  /** The heartbeat keeps a fixed scale; the slow channels scale to their window. */
  isFixedGain: boolean
}

/** The rail's channels in mockup order; rate and cost are left out while the host has no figure. */
export function buildChannels(readings: Readings): Channel[] {
  return [
    activityChannel(readings),
    contextChannel(readings),
    rateChannel(readings),
    costChannel(readings),
  ].filter((channel): channel is Channel => channel !== null)
}

function activityChannel({ now, calls, callCount }: Readings): Channel {
  return {
    id: 'activity',
    label: 'Activity',
    color: COLORS.ecg,
    value: String(callCount),
    unit: '',
    footLeft: 'tool calls',
    footRight: `${callsPerMinute(calls, now)} per min`,
    sampleMs: activitySampleMs(calls.length),
    valueAt: t => activityAt(t, calls),
    isFixedGain: true,
  }
}

function contextChannel({ context, contextHistory, series }: Readings): Channel {
  return {
    id: 'context',
    label: 'Context',
    color: COLORS.spo2,
    value: String(Math.floor(context.percent)),
    unit: '%',
    footLeft: `${Math.floor(context.tokens / 1000)}k of ${Math.floor(context.window / 1000)}k`,
    footRight: `burn +${burnPercent(contextHistory)}% per msg`,
    ...slowTrace(series.context, context.percent / 100),
  }
}

function rateChannel({ now, rateLimits, series }: Readings): Channel | null {
  const fiveHour = findLimit(rateLimits, 'five_hour')
  if (fiveHour === undefined) return null
  const sevenDay = findLimit(rateLimits, 'seven_day')
  const resetsAt = fiveHour.resetsAt === undefined ? NaN : Date.parse(fiveHour.resetsAt)
  return {
    id: 'rate',
    label: 'Rate limit, 5h',
    color: COLORS.resp,
    value: String(Math.floor(fiveHour.percentUsed)),
    unit: '%',
    footLeft: Number.isNaN(resetsAt) ? '' : `resets in ${formatCountdown(resetsAt - now)}`,
    footRight: sevenDay === undefined ? '' : `7 days ${Math.floor(sevenDay.percentUsed)}%`,
    ...slowTrace(series.rate, fiveHour.percentUsed / 100),
  }
}

function costChannel({ costUsd, lastCall, series }: Readings): Channel | null {
  if (costUsd === null) return null
  return {
    id: 'cost',
    label: 'Cost',
    color: COLORS.nibp,
    value: formatUsd(costUsd),
    unit: '',
    footLeft:
      lastCall === null
        ? ''
        : `last call ${formatTokens(lastCall.inputTokens)} in, ${formatTokens(lastCall.outputTokens)} out`,
    footRight: 'real',
    ...slowTrace(series.cost, costUsd),
  }
}

// Each beat costs ~30 path points; past ~100 beats a minute the desktop SVG would near its
// 131072-character cap, so a busy minute is sampled at half the rate.
function activitySampleMs(beats: number): number {
  return beats > 100 ? ACTIVITY_SAMPLE_MS * 2 : ACTIVITY_SAMPLE_MS
}

function slowTrace(points: HudSeries['context'], current: number): Pick<Channel, 'sampleMs' | 'valueAt' | 'isFixedGain'> {
  return { sampleMs: SLOW_SAMPLE_MS, valueAt: t => stepAt(t, points, current), isFixedGain: false }
}
