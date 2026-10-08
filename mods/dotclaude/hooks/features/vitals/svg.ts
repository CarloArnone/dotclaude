import { escapeXml } from '../../ui/banner'
import { COLORS } from '../../ui/tokens'
import {
  ageAlpha,
  autoGain,
  FIXED_GAIN,
  headFrames,
  normalize,
  revealFrames,
  sweep,
  sweepAhead,
} from './trace'
import type { Gain, HeadFrame, RevealFrame, Segment, TracePoint } from './trace'

/**
 * How the desktop traces move. The one switch for it:
 *
 * - 'smil': each channel's SVG animates its own sweep (the head glides, the erase gap
 *   moves) with SMIL. Chromium runs SMIL inside an SVG drawn as an image. Every build
 *   starts the sweep from the clock at that moment, so a rebuild (or the desktop
 *   restarting the image) lands the head where it already was: no jump back. The
 *   desktop redraws on the slow tick or new data, never on the 1 s tick.
 * - 'redraw': a static SVG redrawn every 250 ms from a lighter, decimated path.
 */
export const VITALS_TRACE_MODE: 'smil' | 'redraw' = 'smil'

/** How often the vitals tick: the terminal's traces and clocks, and in 'redraw' the desktop's too. */
export const VITALS_TICK_MS = VITALS_TRACE_MODE === 'smil' ? 1000 : 250
/** Ticks between two desktop redraws when no new data arrives; each starts a fresh 8 s sweep. */
export const TICKS_PER_DESKTOP_REDRAW = VITALS_TRACE_MODE === 'smil' ? 5 : 1

/** What one channel's SVG is drawn from. */
export type ChannelDrawing = {
  id: string
  color: string
  value: string
  unit: string
  isAlarm: boolean
  /** The clock when the SVG is built: the sweep starts from there. */
  at: number
  sampleMs: number
  valueAt: (t: number) => number
  isFixedGain: boolean
}

export type SvgSize = { width: number; height: number }

// Longer than a rebuild's interval, so a late rebuild never finds the sweep stopped.
const ANIMATION_MS = 8000
const PAD = 5
const HEAD_CORE = '#f4fbff'
// The area under the line: a faint wash, so the clipped segments never read as blocks.
const FILL_OPACITY = 0.06
// The decimation of the 'redraw' fallback: half the samples, and no glow filter.
const REDRAW_DECIMATION = 2

/** One channel of the rail, trace and big value, as the mockup's canvas draws it. */
export function channelSvg(drawing: ChannelDrawing, size: SvgSize): string {
  return VITALS_TRACE_MODE === 'smil' ? animatedSvg(drawing, size) : staticSvg(drawing, size)
}

type Frame = {
  id: string
  color: string
  width: number
  height: number
  traceWidth: number
  yOf: (value: number) => number
}

function frameOf(drawing: ChannelDrawing, size: SvgSize, gain: Gain): Frame {
  const width = Math.round(size.width)
  const height = Math.round(size.height)
  // The rest of the width holds the value, as the mockup's 86 px value column does.
  const traceWidth = Math.max(40, width - Math.min(96, Math.round(width * 0.32)))
  return {
    id: drawing.id,
    color: drawing.isAlarm ? COLORS.alarm : drawing.color,
    width,
    height,
    traceWidth,
    yOf: value => PAD + (1 - clamp01(normalize(value, gain))) * (height - PAD * 2),
  }
}

function animatedSvg(drawing: ChannelDrawing, size: SvgSize): string {
  const segments = sweepAhead(drawing.at, drawing.sampleMs, drawing.valueAt, ANIMATION_MS)
  const gain = drawing.isFixedGain ? FIXED_GAIN : autoGain(segments.map(segment => segment.points))
  const frame = frameOf(drawing, size, gain)
  const head = headFrames(drawing.at, ANIMATION_MS, drawing.sampleMs, drawing.valueAt)
  return [
    openSvg(frame),
    sharedDefs(frame, true),
    midline(frame),
    segments.map((segment, i) => segmentSvg(frame, i, segment, drawing.at)).join(''),
    animatedHead(frame, head),
    drawing.isAlarm ? alarmMarker(frame, true) : '',
    valueSvg(frame, drawing.value, drawing.unit),
    '</svg>',
  ].join('')
}

function staticSvg(drawing: ChannelDrawing, size: SvgSize): string {
  const drawn = sweep(drawing.at, drawing.sampleMs * REDRAW_DECIMATION, drawing.valueAt)
  const gain = drawing.isFixedGain ? FIXED_GAIN : autoGain(drawn.runs)
  const frame = frameOf(drawing, size, gain)
  const hx = drawn.headX * frame.traceWidth
  const hy = frame.yOf(drawn.headValue)
  return [
    openSvg(frame),
    sharedDefs(frame, false),
    midline(frame),
    drawn.runs.map((run, i) => runSvg(frame, i, run, false)).join(''),
    `<rect x="${fmt(hx - 0.5)}" y="0" width="1" height="${frame.height}" fill="url(#${frame.id}-scan)"/>`,
    `<g transform="translate(${fmt(hx)},${fmt(hy)})"><circle r="8" fill="url(#${frame.id}-halo)"/><circle r="1.6" fill="${HEAD_CORE}"/></g>`,
    drawing.isAlarm ? alarmMarker(frame, false) : '',
    valueSvg(frame, drawing.value, drawing.unit),
    '</svg>',
  ].join('')
}

function openSvg({ width, height }: Frame): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
}

function sharedDefs({ id, color, width, height }: Frame, hasGlow: boolean): string {
  // In user space over the whole drawing: a bounding-box region is zero tall for a flat
  // line, and the filter then draws nothing, the stroke with it.
  const glow = hasGlow
    ? `<filter id="${id}-glow" filterUnits="userSpaceOnUse" x="-10" y="-10" width="${width + 20}" height="${height + 20}">` +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur"/>' +
      '<feComponentTransfer in="blur" result="soft"><feFuncA type="linear" slope="0.55"/></feComponentTransfer>' +
      '<feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    : ''
  return (
    '<defs>' +
    glow +
    // the area fill fades toward the floor, as the mockup's destination-out pass does
    `<linearGradient id="${id}-floor" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">` +
    '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' +
    `<mask id="${id}-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="url(#${id}-floor)"/></mask>` +
    `<radialGradient id="${id}-halo" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="8"><stop offset="0" stop-color="${color}" stop-opacity="0.45"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-scan" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="0.5" stop-color="${color}" stop-opacity="0.18"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>` +
    '</defs>'
  )
}

/** A segment drawn whole, shown through a clip the head widens and the erase gap narrows. */
function segmentSvg(frame: Frame, index: number, segment: Segment, now: number): string {
  const frames = revealFrames(segment, now, ANIMATION_MS)
  if (frames.every(one => one.width === 0)) return ''
  const clipId = `${frame.id}-clip${index}`
  return (
    `<clipPath id="${clipId}">${revealRect(frame, frames)}</clipPath>` +
    `<g clip-path="url(#${clipId})">${runSvg(frame, index, segment.points, true)}</g>`
  )
}

function revealRect(frame: Frame, frames: RevealFrame[]): string {
  const first = frames[0]!
  const keyTimes = frames.map(one => keyTime(one.at)).join(';')
  const xs = frames.map(one => fmt(one.x * frame.traceWidth)).join(';')
  const widths = frames.map(one => fmt(one.width * frame.traceWidth)).join(';')
  return (
    `<rect x="${fmt(first.x * frame.traceWidth)}" y="-6" width="${fmt(first.width * frame.traceWidth)}" height="${frame.height + 12}">` +
    `<animate attributeName="x" ${timing(keyTimes)} values="${xs}"/>` +
    `<animate attributeName="width" ${timing(keyTimes)} values="${widths}"/>` +
    '</rect>'
  )
}

/** The head: a scan line that follows it across, and a glowing dot that also follows the value. */
function animatedHead(frame: Frame, head: HeadFrame[]): string {
  const first = head[0]!
  const keyTimes = head.map(one => keyTime(one.at)).join(';')
  const across = head.map(one => `${fmt(one.x * frame.traceWidth)},0`).join(';')
  const dot = head.map(one => `${fmt(one.x * frame.traceWidth)},${fmt(frame.yOf(one.value))}`).join(';')
  const start = `${fmt(first.x * frame.traceWidth)}`
  return (
    `<g transform="translate(${start},0)">` +
    `<animateTransform attributeName="transform" type="translate" ${timing(keyTimes)} values="${across}"/>` +
    `<rect x="-0.5" y="0" width="1" height="${frame.height}" fill="url(#${frame.id}-scan)"/></g>` +
    `<g transform="translate(${start},${fmt(frame.yOf(first.value))})">` +
    `<animateTransform attributeName="transform" type="translate" ${timing(keyTimes)} values="${dot}"/>` +
    `<circle r="8" fill="url(#${frame.id}-halo)"/><circle r="1.6" fill="${HEAD_CORE}"/></g>`
  )
}

function timing(keyTimes: string): string {
  return `dur="${ANIMATION_MS / 1000}s" fill="freeze" calcMode="linear" keyTimes="${keyTimes}"`
}

function keyTime(at: number): string {
  return (at / ANIMATION_MS).toFixed(4)
}

function runSvg(frame: Frame, index: number, run: readonly TracePoint[], hasGlow: boolean): string {
  const { id, color, height, traceWidth, yOf } = frame
  const points = run.map(point => [point.x * traceWidth, yOf(point.value)] as const)
  const x0 = points[0]![0]
  const x1 = points[points.length - 1]![0]
  const a0 = ageAlpha(run[0]!.ageMs)
  const a1 = ageAlpha(run[run.length - 1]!.ageMs)
  const line = smoothPath(points)
  const fade = (key: string, scale: number) =>
    `<linearGradient id="${id}-${key}${index}" gradientUnits="userSpaceOnUse" x1="${fmt(x0)}" y1="0" x2="${fmt(x1)}" y2="0">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="${fmt(scale * a0, 3)}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="${fmt(scale * a1, 3)}"/></linearGradient>`
  const glow = hasGlow ? ` filter="url(#${id}-glow)"` : ''
  return (
    `<defs>${fade('fill', FILL_OPACITY)}${fade('ink', 1)}</defs>` +
    `<path d="${line} L${fmt(x1)} ${height} L${fmt(x0)} ${height} Z" fill="url(#${id}-fill${index})" mask="url(#${id}-fade)"/>` +
    `<path d="${line}" fill="none" stroke="url(#${id}-ink${index})" stroke-width="1.75" ` +
    `stroke-linecap="round" stroke-linejoin="round"${glow}/>`
  )
}

/** Quadratic curves through the midpoints: continuous tangents, no overshoot. */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const [first, ...rest] = points
  let d = `M${fmt(first![0])} ${fmt(first![1])}`
  for (let i = 0; i < rest.length - 1; i++) {
    const [x, y] = rest[i]!
    const [nx, ny] = rest[i + 1]!
    d += ` Q${fmt(x)} ${fmt(y)} ${fmt((x + nx) / 2)} ${fmt((y + ny) / 2)}`
  }
  const last = rest[rest.length - 1] ?? first!
  return `${d} L${fmt(last[0])} ${fmt(last[1])}`
}

function midline({ height, traceWidth }: Frame): string {
  const y = height / 2 + 0.5
  return `<line x1="0" y1="${y}" x2="${traceWidth}" y2="${y}" stroke="rgb(160,190,230)" stroke-opacity="0.10" stroke-dasharray="1 5"/>`
}

// The mockup blinks the alarm bar with steps(2); in 'redraw' the bar stays lit and the
// label's marker blinks with the tick instead.
function alarmMarker({ height }: Frame, isAnimated: boolean): string {
  const blink = isAnimated
    ? '<animate attributeName="opacity" values="1;0" calcMode="discrete" dur="1s" repeatCount="indefinite"/>'
    : ''
  return `<rect x="0" y="0" width="3" height="${height}" fill="${COLORS.alarm}">${blink}</rect>`
}

function valueSvg({ color, width, height }: Frame, value: string, unit: string): string {
  const size = Math.round(Math.min(40, Math.max(22, height * 0.7)))
  const unitSpan = unit === '' ? '' : `<tspan font-size="${Math.round(size * 0.45)}" dx="1">${escapeXml(unit)}</tspan>`
  return (
    `<text x="${width - 2}" y="${height - 4}" text-anchor="end" fill="${color}" font-size="${size}" font-weight="600" ` +
    `font-family="'Barlow Condensed','Arial Narrow',sans-serif" style="font-variant-numeric:tabular-nums">` +
    `${escapeXml(value)}${unitSpan}</text>`
  )
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits)
}
