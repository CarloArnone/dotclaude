import type { MainView, SideView } from '../../../types'

type DockView = Exclude<MainView, 'vitals'> | SideView

/** The vitals rail's dock, in mockup order: one button per feature. */
export const DOCK: readonly { view: DockView; label: string }[] = [
  { view: 'gate', label: 'Gate' },
  { view: 'plan', label: 'Plan' },
  { view: 'ledger', label: 'Ledger' },
  { view: 'mac', label: 'Mac' },
  { view: 'brain', label: 'Brain' },
  { view: 'radar', label: 'Radar' },
  { view: 'companion', label: 'Companion' },
  { view: 'git', label: 'Git' },
  { view: 'crew', label: 'Crew' },
]

const SIDE_VIEWS: ReadonlySet<string> = new Set<SideView>(['gate', 'plan', 'mac', 'brain', 'radar'])

export function isSideView(view: DockView): view is SideView {
  return SIDE_VIEWS.has(view)
}

const COLUMN_GAP = 2

export type ColumnSplit = { main: number; side: number; gap: number }

/** The pane's columns shared between the main column and, when one is open, the side panel. */
export function splitColumns(total: number, hasSide: boolean): ColumnSplit {
  if (!hasSide) return { main: total, side: 0, gap: 0 }
  const usable = Math.max(2, total - COLUMN_GAP)
  const main = Math.floor(usable / 2)
  return { main, side: usable - main, gap: COLUMN_GAP }
}
