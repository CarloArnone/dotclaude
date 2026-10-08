import type { HudPoint } from '../../../types'

/** One sweep of the write head across the channel, as on a bedside monitor. */
export const WINDOW_MS = 60_000
/** Blanked ahead of the head: the mockup's 14 of 240 samples. */
export const ERASE_MS = 3_500
export const ACTIVITY_SAMPLE_MS = 1000 / 30
// Slow channels change only when measured; a 1 s grid turns each jump into a short ramp.
export const SLOW_SAMPLE_MS = 1000

const BEAT_SAMPLES = 30
const BASELINE = 0.3

export type TracePoint = { x: number; value: number; ageMs: number }
export type Sweep = { headX: number; headValue: number; runs: TracePoint[][] }
export type Gain = { lo: number; hi: number }

/**
 * The heartbeat keeps a fixed scale so a spike always reads as a spike, centred on the
 * idle baseline: a quiet channel is a line across the middle, the R wave reaches the top.
 */
export const FIXED_GAIN: Gain = { lo: BASELINE - 0.6, hi: BASELINE + 0.6 }
// How much room auto-gain leaves around the window's range: a little, so the line spans the height.
const GAIN_MARGIN = 1.15

const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd))

/** One PQRST complex above the baseline, `p` samples (30 a second) after a tool call. */
export function beatDeviation(p: number): number {
  if (p < 0 || p > BEAT_SAMPLES) return 0
  return (
    0.07 * gauss(p, 5, 1.8) -
    0.06 * gauss(p, 10.2, 0.7) +
    0.56 * gauss(p, 11.6, 0.8) -
    0.14 * gauss(p, 13, 0.8) +
    0.12 * gauss(p, 21, 2.6)
  )
}

export function activityAt(t: number, calls: readonly number[]): number {
  let value = BASELINE
  for (const at of calls) value += beatDeviation((t - at) / ACTIVITY_SAMPLE_MS)
  return value
}

/** The reading in force at `t`; before the first reading, the first; with none, `fallback`. */
export function stepAt(t: number, points: readonly HudPoint[], fallback: number): number {
  let value = points[0]?.value ?? fallback
  for (const point of points) {
    if (point.at > t) break
    value = point.value
  }
  return value
}

/**
 * The window as two runs either side of the erase gap: the newest from the left edge to
 * the head, the oldest from past the gap to the right edge, each point placed 0..1 across.
 */
export function sweep(now: number, sampleMs: number, valueAt: (t: number) => number): Sweep {
  const cycleStart = now - (now % WINDOW_MS)
  const place = (origin: number) => (t: number): TracePoint => ({
    x: (t - origin) / WINDOW_MS,
    value: valueAt(t),
    ageMs: now - t,
  })
  const newest = sampleTimes(cycleStart, now, sampleMs).map(place(cycleStart))
  const oldest = sampleTimes(now - WINDOW_MS + ERASE_MS, cycleStart, sampleMs).map(
    place(cycleStart - WINDOW_MS),
  )
  return {
    headX: (now - cycleStart) / WINDOW_MS,
    headValue: valueAt(now),
    runs: [newest, oldest].filter(run => run.length >= 2).map(dropFlatInterior),
  }
}

/** A stretch of samples inside one sweep cycle, from `from` to `to` (ms), placed 0..1 across. */
export type Segment = { cycleStart: number; from: number; to: number; points: TracePoint[] }

/**
 * Every sample the screen shows from `now` until `aheadMs` later: from the oldest still
 * past the erase gap to the newest the head will have written, split where the head wraps.
 * The future is known: a beat already started runs on, a slow reading holds.
 */
export function sweepAhead(
  now: number,
  sampleMs: number,
  valueAt: (t: number) => number,
  aheadMs: number,
): Segment[] {
  const from = now - WINDOW_MS + ERASE_MS
  const to = now + aheadMs
  const segments: Segment[] = []
  for (let cycleStart = from - mod(from, WINDOW_MS); cycleStart < to; cycleStart += WINDOW_MS) {
    const a = Math.max(from, cycleStart)
    const b = Math.min(to, cycleStart + WINDOW_MS)
    const points = sampleTimes(a, b, sampleMs).map(t => ({
      x: (t - cycleStart) / WINDOW_MS,
      value: valueAt(t),
      ageMs: Math.max(0, now - t),
    }))
    if (points.length >= 2) segments.push({ cycleStart, from: a, to: b, points: dropFlatInterior(points) })
  }
  return segments
}

/** The visible part of a segment at `at` ms after `now`: its left edge and width, 0..1 across. */
export type RevealFrame = { at: number; x: number; width: number }

/**
 * Where a segment shows over the next `durationMs`: the head uncovers it from the left,
 * the erase gap takes it away from the left a sweep later. Linear between the frames.
 */
export function revealFrames(segment: Segment, now: number, durationMs: number): RevealFrame[] {
  const gapLag = WINDOW_MS - ERASE_MS
  const candidates = [
    0,
    durationMs,
    segment.from - now,
    segment.to - now,
    segment.from - now + gapLag,
    segment.to - now + gapLag,
  ]
  const times = [...new Set(candidates.filter(at => at >= 0 && at <= durationMs))].sort((a, b) => a - b)
  const xOf = (t: number) => (t - segment.cycleStart) / WINDOW_MS
  return times.map(at => {
    const lo = Math.max(segment.from, now + at - gapLag)
    const hi = Math.min(segment.to, now + at)
    if (hi > lo) return { at, x: xOf(lo), width: xOf(hi) - xOf(lo) }
    return { at, x: xOf(Math.min(Math.max(lo, segment.from), segment.to)), width: 0 }
  })
}

/** Where the write head is at `at` ms after `now`: 0..1 across, and the value it writes. */
export type HeadFrame = { at: number; x: number; value: number }

/**
 * The head's path over the next `durationMs`, every `stepMs`; where it wraps it holds two
 * frames at the same time, right edge then left, so it jumps instead of sliding back.
 */
export function headFrames(
  now: number,
  durationMs: number,
  stepMs: number,
  valueAt: (t: number) => number,
): HeadFrame[] {
  const frames: HeadFrame[] = []
  const firstWrap = now - mod(now, WINDOW_MS) + WINDOW_MS
  const times = new Set<number>([0, durationMs])
  for (let at = stepMs; at < durationMs; at += stepMs) times.add(at)
  for (let wrap = firstWrap; wrap <= now + durationMs; wrap += WINDOW_MS) times.add(wrap - now)
  for (const at of [...times].sort((a, b) => a - b)) {
    const t = now + at
    const value = valueAt(t)
    const x = mod(t, WINDOW_MS) / WINDOW_MS
    if (x === 0 && at > 0) frames.push({ at, x: 1, value })
    frames.push({ at, x, value })
  }
  return dropSteadyFrames(frames)
}

/** Auto-gain: the window's range with a small margin, never narrower than .04; a flat line sits centred. */
export function autoGain(runs: readonly (readonly { value: number }[])[]): Gain {
  const values = runs.flat().map(point => point.value)
  if (values.length === 0) return FIXED_GAIN
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const mid = (lo + hi) / 2
  const span = Math.max(0.04, hi - lo) * GAIN_MARGIN
  return { lo: mid - span / 2, hi: mid + span / 2 }
}

export function normalize(value: number, gain: Gain): number {
  return (value - gain.lo) / (gain.hi - gain.lo)
}

/** Phosphor persistence: the newest ink is full strength, the oldest fades to .12. */
export function ageAlpha(ageMs: number): number {
  const age = Math.min(1, Math.max(0, ageMs / WINDOW_MS))
  return 0.12 + 0.88 * Math.pow(1 - age, 1.6)
}

/** Times on the sample grid between `from` and `to`, both ends kept so runs meet the head and the edge. */
function sampleTimes(from: number, to: number, step: number): number[] {
  if (to <= from) return []
  const times = [from]
  for (let t = Math.floor(from / step) * step + step; t < to; t += step) times.push(t)
  times.push(to)
  return times
}

// A flat stretch needs only its ends; this keeps an idle heartbeat to a few points.
function dropFlatInterior<P extends { value: number }>(run: P[]): P[] {
  return run.filter(
    (point, i) =>
      i === 0 ||
      i === run.length - 1 ||
      point.value !== run[i - 1]!.value ||
      point.value !== run[i + 1]!.value,
  )
}

// Between two frames of one sweep the head moves in a straight line, so a frame whose
// value matches both neighbours, with no wrap around it, adds nothing.
function dropSteadyFrames(frames: HeadFrame[]): HeadFrame[] {
  return frames.filter((frame, i) => {
    const before = frames[i - 1]
    const after = frames[i + 1]
    if (before === undefined || after === undefined) return true
    const isSameSweep = before.x <= frame.x && frame.x <= after.x
    return !(isSameSweep && frame.value === before.value && frame.value === after.value)
  })
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}
