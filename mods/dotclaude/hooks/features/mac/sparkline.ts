// Sparklines of 0-100 readings: block characters for the terminal, a
// smooth SVG line for the desktop. Both use a fixed 0-100 scale so a flat
// 40% never looks like a spike.

const BLOCKS = '▁▂▃▄▅▆▇█'

export function blockSparkline(values: readonly number[], width: number): string {
  return values
    .slice(Math.max(0, values.length - Math.max(0, width)))
    .map(value => BLOCKS[Math.round((clamp(value) / 100) * (BLOCKS.length - 1))])
    .join('')
}

export function svgSparkline(
  values: readonly number[],
  color: string,
  size: { width: number; height: number },
): string {
  const { width, height } = size
  const points = values.map((value, index) => ({
    x: values.length === 1 ? width : (index / (values.length - 1)) * width,
    y: height - 1 - (clamp(value) / 100) * (height - 2),
  }))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<path d="${smoothPath(points)}" fill="none" stroke="${color}" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}

type Point = { x: number; y: number }

/** Quadratic curves through the midpoints: smooth, and never overshoots the scale. */
function smoothPath(points: readonly Point[]): string {
  const [first, ...rest] = points
  if (first === undefined) return ''
  if (rest.length === 0) return `M0 ${round(first.y)} L${round(first.x)} ${round(first.y)}`

  let path = `M${round(first.x)} ${round(first.y)}`
  let previous = first
  for (const point of rest) {
    const midX = (previous.x + point.x) / 2
    const midY = (previous.y + point.y) / 2
    path += ` Q${round(previous.x)} ${round(previous.y)} ${round(midX)} ${round(midY)}`
    previous = point
  }

  return `${path} L${round(previous.x)} ${round(previous.y)}`
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
