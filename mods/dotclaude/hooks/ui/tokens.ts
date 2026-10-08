import type { MainView, SideView } from '../../types'

/** The mockup's design tokens (mockups/index.html :root). */
export const COLORS = {
  ink: '#0f1722',
  well: '#0b121b',
  plate: '#1a2636',
  text: '#dbe6f3',
  muted: '#7f93ab',
  ecg: '#3ddc97',
  spo2: '#4cc9f0',
  resp: '#f2c14e',
  nibp: '#f072b6',
  alarm: '#ff5a5f',
  lock: '#c7b8ff',
  caveman: '#e9a35b',
} as const

export type PanelId = MainView | SideView

/** Each panel's banner title, channel colour, and the glyph the terminal draws for its badge. */
export const PANELS: Record<PanelId, { title: string; color: string; glyph: string }> = {
  vitals: { title: 'Vitals', color: COLORS.ecg, glyph: '♥' },
  gate: { title: 'Gate', color: COLORS.lock, glyph: '◈' },
  plan: { title: 'Plan review', color: COLORS.spo2, glyph: '▤' },
  ledger: { title: 'Ledger', color: COLORS.resp, glyph: '≡' },
  companion: { title: 'Companion', color: COLORS.spo2, glyph: '◫' },
  mac: { title: 'Mac', color: COLORS.ecg, glyph: '▭' },
  brain: { title: 'Second brain', color: COLORS.nibp, glyph: '◎' },
  radar: { title: 'Radar', color: COLORS.ecg, glyph: '◉' },
  git: { title: 'Git', color: COLORS.resp, glyph: '⎇' },
  crew: { title: 'Crew', color: COLORS.nibp, glyph: '◍' },
}

/**
 * The desktop measures a pane in cells of its code font; these turn cells into
 * CSS pixels for the SVGs. Estimates, not read from the host (no API says them).
 */
export const DESKTOP_CELL = { width: 7.8, height: 19 } as const
