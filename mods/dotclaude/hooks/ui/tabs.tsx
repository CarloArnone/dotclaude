import type { RenderElement } from 'claude-code'

import type { Rich } from './chrome'

export type Tab<T extends string> = { id: T; label: string }

/**
 * A panel's views side by side under its banner: the shown one is the primary button,
 * the others plain. `key` names the strip; each tab's key is `<key>-<id>`.
 */
export function tabStrip<T extends string>(
  t: Rich,
  key: string,
  tabs: readonly Tab<T>[],
  active: T,
  select: (id: T) => void,
): RenderElement {
  const { Box, Button } = t
  return (
    <Box key={key} flexDirection="row" gap={1}>
      {tabs.map(tab => (
        <Button
          key={`${key}-${tab.id}`}
          label={tab.label}
          variant={tab.id === active ? 'primary' : undefined}
          onPress={() => select(tab.id)}
        />
      ))}
    </Box>
  )
}
