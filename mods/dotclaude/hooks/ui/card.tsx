import type { RenderElement, RenderNode } from 'claude-code'

import { escapeXml } from './banner'
import type { Kit } from './chrome'
import { COLORS } from './tokens'

const TILE_PX = 34

/**
 * A list card as an extensions list draws one: a tile on the left, then lines of text in
 * a column that may shrink, so its text wraps inside the card instead of running past it.
 * `key` names the card; its text column is `<key>-text`.
 */
export function card(kit: Kit, key: string, tile: RenderElement, lines: (RenderNode | null)[]): RenderElement {
  const { Box } = kit.t
  return (
    <Box key={key} flexDirection="row" gap={1} borderStyle="round" borderColor={COLORS.plate} paddingX={1}>
      {tile}
      <Box key={`${key}-text`} flexDirection="column" flexShrink={1} minWidth={0}>
        {lines}
      </Box>
    </Box>
  )
}

/** A letter on a tile of `color`: an SVG on the desktop, a coloured block in the terminal. */
export function initialTile(kit: Kit, initial: string, color: string, alt: string): RenderElement {
  if (kit.surface === 'desktop') {
    const { Svg } = kit.t
    return <Svg alt={alt} source={tileSvg(initial, color)} width={TILE_PX} height={TILE_PX} />
  }
  const { Text } = kit.t
  return (
    <Text bold color={COLORS.ink} backgroundColor={color}>
      {` ${initial} `}
    </Text>
  )
}

function tileSvg(initial: string, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_PX}" height="${TILE_PX}" viewBox="0 0 ${TILE_PX} ${TILE_PX}">` +
    `<rect width="${TILE_PX}" height="${TILE_PX}" rx="8" fill="${color}" fill-opacity="0.2"/>` +
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="${color}" font-size="17" font-weight="700" ` +
    `font-family="'Barlow Condensed','Arial Narrow',sans-serif">${escapeXml(initial)}</text></svg>`
  )
}
