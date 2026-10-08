import type { RenderElement } from 'claude-code'

import { badgeSvg } from '../../ui/banner'
import { buttonRow } from '../../ui/chrome'
import type { Kit } from '../../ui/chrome'
import { PANELS } from '../../ui/tokens'
import { DOCK } from '../nav/logic'

export type DockView = (typeof DOCK)[number]['view']

const TILE_PX = 22
// A terminal entry: the coloured glyph, a gap and `[ label ]`.
const ENTRY_EXTRA_CELLS = 6

/**
 * The dock: one native button per feature with its panel's badge beside it, the colour a
 * native button cannot carry. (Linked images in a Markdown were tried as icon-only buttons:
 * the desktop draws Markdown images as text and opens the link instead of reporting the press.)
 */
export function dock(kit: Kit, open: (view: DockView) => void): RenderElement {
  const { Box, Button } = kit.t
  return buttonRow(
    kit.t,
    'dock',
    DOCK.map(entry => (
      <Box key={`dock-entry-${entry.view}`} flexDirection="row" gap={1} alignItems="center">
        {tile(kit, entry.view, entry.label)}
        <Button key={`dock-${entry.view}`} label={entry.label} onPress={() => open(entry.view)} />
      </Box>
    )),
  )
}

/** Rows the dock takes in `columns` cells. */
export function dockRows(kit: Kit, columns: number): number {
  const rowHeight = kit.surface === 'desktop' ? 2 : 1
  return wrappedRows(DOCK.map(entry => entry.label), columns) * rowHeight
}

/** The panel's badge beside its button: the colour a native button cannot carry. */
function tile(kit: Kit, view: DockView, label: string): RenderElement {
  const { color, glyph } = PANELS[view]
  if (kit.surface === 'desktop') {
    const { Svg } = kit.t
    return <Svg alt={label} source={badgeSvg(view, color)} width={TILE_PX} height={TILE_PX} />
  }
  const { Text } = kit.t
  return (
    <Text bold color={color}>
      {glyph}
    </Text>
  )
}

/** How many rows a wrapped row of dock entries (glyph and `[ label ]`) takes in `width` cells. */
function wrappedRows(labels: readonly string[], width: number): number {
  let rows = 1
  let used = 0
  for (const label of labels) {
    const cells = label.length + ENTRY_EXTRA_CELLS
    const next = used === 0 ? cells : used + 1 + cells
    if (next > width && used > 0) {
      rows += 1
      used = cells
    } else {
      used = next
    }
  }
  return rows
}
