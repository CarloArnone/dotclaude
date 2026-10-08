import { ageAlpha, normalize, WINDOW_MS } from './trace'
import type { Gain, Sweep } from './trace'

export type RasterDrawing = {
  color: string
  sweep: Sweep
  gain: Gain
  columns: number
  rows: number
}

const BRAILLE_BLANK = 0x2800
// Braille dot bits by [row][column] inside one 2×4 cell.
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const
const INK = 0x0f1722
const HEAD_CORE = 0xf4fbff
const DEFAULT_COLOR = 0x01000000

/** The channel's trace as a braille line plot, packed as `RasterProps.cells` expects. */
export function brailleCells(drawing: RasterDrawing): string {
  const dots = plotDots(drawing)
  const headColumn = Math.min(drawing.columns - 1, Math.floor(drawing.sweep.headX * drawing.columns))
  const rgb = parseHex(drawing.color)
  const words = new Uint32Array(drawing.columns * drawing.rows * 3)
  for (let row = 0; row < drawing.rows; row++) {
    for (let column = 0; column < drawing.columns; column++) {
      const bits = cellBits(dots, column, row)
      const at = (row * drawing.columns + column) * 3
      words[at] = BRAILLE_BLANK | bits
      words[at + 1] = bits === 0 ? DEFAULT_COLOR : cellColor(drawing, rgb, column, headColumn)
      words[at + 2] = DEFAULT_COLOR
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

/** A dot grid, `columns × 2` wide and `rows × 4` tall, with each run drawn as a connected line. */
function plotDots(drawing: RasterDrawing): boolean[][] {
  const width = drawing.columns * 2
  const height = drawing.rows * 4
  const grid = Array.from({ length: height }, () => new Array<boolean>(width).fill(false))
  const toDot = (x: number, value: number) => ({
    x: Math.min(width - 1, Math.floor(x * width)),
    y: (1 - clamp01(normalize(value, drawing.gain))) * (height - 1),
  })
  for (const run of drawing.sweep.runs) {
    for (let i = 1; i < run.length; i++) {
      const from = toDot(run[i - 1]!.x, run[i - 1]!.value)
      const to = toDot(run[i]!.x, run[i]!.value)
      plotSegment(grid, from, to)
    }
  }
  return grid
}

// Each dot column gets the vertical span the segment crosses in it, so a spike narrower
// than a column still shows at full height.
function plotSegment(grid: boolean[][], from: Dot, to: Dot): void {
  const steps = Math.max(1, to.x - from.x)
  for (let x = from.x; x <= to.x; x++) {
    const yA = lerp(from.y, to.y, (x - from.x) / steps)
    const yB = lerp(from.y, to.y, Math.min(1, (x + 1 - from.x) / steps))
    const top = Math.round(Math.min(yA, yB))
    const bottom = Math.round(Math.max(yA, yB))
    for (let y = top; y <= bottom; y++) grid[y]![x] = true
  }
}

type Dot = { x: number; y: number }

function cellBits(dots: boolean[][], column: number, row: number): number {
  let bits = 0
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (dots[row * 4 + dy]![column * 2 + dx]) bits |= DOT_BITS[dy]![dx]!
    }
  }
  return bits
}

function cellColor(drawing: RasterDrawing, rgb: number, column: number, headColumn: number): number {
  if (column === headColumn) return HEAD_CORE
  const x = (column + 0.5) / drawing.columns
  const ageMs = (((drawing.sweep.headX - x) % 1) + 1) % 1 * WINDOW_MS
  return mixTowardInk(rgb, ageAlpha(ageMs))
}

function mixTowardInk(rgb: number, alpha: number): number {
  const channel = (shift: number) => {
    const ink = (INK >> shift) & 0xff
    const color = (rgb >> shift) & 0xff
    return Math.round(ink + (color - ink) * alpha) << shift
  }
  return channel(16) | channel(8) | channel(0)
}

function parseHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
