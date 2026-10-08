import type { ElementTable, RenderElement, RenderNode } from 'claude-code'

import type { ColumnSplit } from '../features/nav/logic'
import { bannerSvg } from './banner'
import { DESKTOP_CELL, PANELS } from './tokens'
import type { PanelId } from './tokens'

/** The element table of a surface that draws the full panels, with the surface it belongs to. */
export type Kit =
  | { surface: 'terminal'; t: ElementTable<'terminal'> }
  | { surface: 'desktop'; t: ElementTable<'desktop'> }

/** The elements both full surfaces share. */
export type Rich = ElementTable<'terminal'> | ElementTable<'desktop'>

// Room the "× Close" button takes beside the banner, in cells.
const CLOSE_CELLS = 11

/** A panel: its banner (with a close control when it can close), then its body. */
export function panel(
  kit: Kit,
  id: PanelId,
  columns: number,
  body: (RenderNode | null)[],
  onClose?: () => void,
): RenderElement {
  const { Box } = kit.t
  return (
    <Box key={`panel-${id}`} flexDirection="column" gap={1} width={columns} minWidth={0} overflow="hidden">
      {panelHeader(kit, id, columns, onClose)}
      {body}
    </Box>
  )
}

function panelHeader(kit: Kit, id: PanelId, columns: number, onClose?: () => void): RenderElement {
  const { title, color } = PANELS[id]
  const { Box, Button, Text } = kit.t
  const close = onClose === undefined ? null : <Button key={`close-${id}`} label="× Close" onPress={onClose} />
  if (kit.surface === 'desktop') {
    const { Svg } = kit.t
    const bannerCells = columns - (onClose === undefined ? 0 : CLOSE_CELLS)
    return (
      <Box key={`head-${id}`} flexDirection="row" gap={1} alignItems="center">
        <Box key={`banner-${id}`} flexGrow={1}>
          <Svg alt={title} source={bannerSvg(id, title, color, bannerCells * DESKTOP_CELL.width)} />
        </Box>
        {close}
      </Box>
    )
  }
  return (
    <Box key={`head-${id}`} flexDirection="row" justifyContent="space-between" gap={1}>
      <Text bold color={color}>{`▍${title}`}</Text>
      {close}
    </Box>
  )
}

/** A group of buttons, wrapping as the room allows; `key` names the row. */
export function buttonRow(t: Rich, key: string, buttons: RenderNode[]): RenderElement {
  const { Box } = t
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" gap={1}>
      {buttons}
    </Box>
  )
}

/**
 * The workspace: the side panel on the left when one is open, then the main column. Each
 * column holds its share of the width and clips what would not fit, so a long line can
 * never paint over the column beside it.
 */
export function columns(t: Rich, split: ColumnSplit, main: RenderElement, side: RenderElement | null): RenderElement {
  const { Box } = t
  return (
    <Box key="workspace" flexDirection="row" gap={split.gap}>
      {side !== null && (
        <Box key="side-column" flexDirection="column" width={split.side} flexShrink={1} minWidth={0} overflow="hidden">
          {side}
        </Box>
      )}
      <Box key="main-column" flexDirection="column" width={split.main} flexShrink={1} minWidth={0} overflow="hidden">
        {main}
      </Box>
    </Box>
  )
}
