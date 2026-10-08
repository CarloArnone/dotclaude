import { COLORS } from './tokens'
import type { PanelId } from './tokens'

const BANNER_HEIGHT = 40
const BADGE_SIZE = 26
const ART_WIDTH = 150

// The mockup's dock icons (24×24, stroked), plus branch and people for Git and Crew.
const GLYPHS: Record<PanelId, string> = {
  vitals: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  gate: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plan: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  ledger: '<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>',
  companion: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  mac: '<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M9 20h6M12 16v4"/>',
  brain:
    '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>',
  git: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 8v8M17 10c0 4-10 2-10 6"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M15 14c3 0 6 2 6 5"/>',
}

// Faint artwork on the banner's right, in a 150×40 box: the panel's motif, drawn large.
const ARTWORK: Record<PanelId, string> = {
  vitals: '<path d="M0 24h28l5-12 6 22 5-14 4 4h30l5-12 6 22 5-14 4 4h52"/>',
  gate: '<rect x="96" y="14" width="28" height="22" rx="4"/><path d="M102 14V9a8 8 0 0 1 16 0v5M0 25h84M136 25h14" stroke-dasharray="2 5"/>',
  plan: '<path d="M88 2h30l12 12v30H88z"/><path d="M118 2v12h12M96 22h26M96 30h26M96 38h18M0 20h72M0 30h56"/>',
  ledger: '<path d="M20 8h130M20 18h110M20 28h124M20 38h80"/><circle cx="8" cy="8" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="8" cy="28" r="2"/>',
  companion: '<rect x="40" y="4" width="104" height="40" rx="5"/><path d="M40 13h104M92 13v31"/><circle cx="47" cy="8.5" r="1.5"/><circle cx="53" cy="8.5" r="1.5"/>',
  mac: '<rect x="56" y="4" width="70" height="28" rx="4"/><path d="M82 40h18M91 32v8"/><rect x="0" y="12" width="26" height="20" rx="3"/><path d="M4 8v4M13 8v4M22 8v4M4 32v4M13 32v4M22 32v4M26 22h30"/>',
  brain:
    '<path d="M96 6a9 9 0 0 0-9 9 9 9 0 0 0-6 15 9 9 0 0 0 6 15M114 6a9 9 0 0 1 9 9 9 9 0 0 1 6 15M105 4v40"/><circle cx="20" cy="14" r="2"/><circle cx="44" cy="30" r="2"/><circle cx="66" cy="12" r="2"/><path d="M20 14l24 16 22-18"/>',
  radar: '<circle cx="118" cy="22" r="30"/><circle cx="118" cy="22" r="18"/><circle cx="118" cy="22" r="6"/><path d="M118 22l24-22M0 22h80"/><circle cx="102" cy="12" r="2"/>',
  git: '<path d="M0 30h150M60 30c20 0 20-18 40-18h50"/><circle cx="30" cy="30" r="3"/><circle cx="60" cy="30" r="3"/><circle cx="110" cy="12" r="3"/><circle cx="130" cy="30" r="3"/>',
  crew: '<circle cx="70" cy="14" r="7"/><circle cx="100" cy="12" r="8"/><circle cx="130" cy="14" r="7"/><path d="M58 40c0-8 5-13 12-13s12 5 12 13M86 40c0-9 6-15 14-15s14 6 14 15M118 40c0-8 5-13 12-13s12 5 12 13"/>',
}

/** The desktop banner a panel starts with: its glyph, its title and faint artwork in its colour. */
export function bannerSvg(panel: PanelId, title: string, color: string, width: number): string {
  const w = Math.max(160, Math.round(width))
  const h = BANNER_HEIGHT
  const artX = Math.max(140, w - ART_WIDTH - 10)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs><linearGradient id="wash" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="${color}" stop-opacity="0.16"/>`,
    `<stop offset="0.6" stop-color="${color}" stop-opacity="0.04"/>`,
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`,
    `<rect width="${w}" height="${h}" rx="9" fill="${COLORS.plate}"/>`,
    `<rect width="${w}" height="${h}" rx="9" fill="url(#wash)"/>`,
    `<g transform="translate(${artX} -4)" fill="none" stroke="${color}" stroke-opacity="0.28" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ARTWORK[panel]}</g>`,
    badge(panel, color, 8, 7),
    `<text x="44" y="26.5" fill="${COLORS.text}" font-size="19" font-weight="600" letter-spacing="0.2" `,
    `font-family="'Barlow Condensed','Avenir Next Condensed','Arial Narrow',sans-serif">${escapeXml(title)}</text>`,
    '</svg>',
  ].join('')
}

/** The panel's badge alone, drawn `size` px square: the dock's tile. */
export function badgeSvg(panel: PanelId, color: string, size = BADGE_SIZE): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BADGE_SIZE} ${BADGE_SIZE}">` +
    `${badge(panel, color, 0, 0)}</svg>`
  )
}

/** The panel's glyph on a tile tinted with its colour, 26 px square, at (x, y). */
function badge(panel: PanelId, color: string, x: number, y: number): string {
  return (
    `<rect x="${x}" y="${y}" width="${BADGE_SIZE}" height="${BADGE_SIZE}" rx="7" fill="${color}" fill-opacity="0.16"/>` +
    `<g transform="translate(${x + 3} ${y + 3}) scale(0.833)" fill="none" stroke="${color}" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round">${GLYPHS[panel]}</g>`
  )
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
