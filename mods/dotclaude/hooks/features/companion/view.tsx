import type { RenderElement } from 'claude-code'

import { buttonRow, panel } from '../../ui/chrome'
import type { Kit } from '../../ui/chrome'
import { COLORS } from '../../ui/tokens'

export type CompanionModel = {
  isOpen: boolean
  url: string
  open: () => void
  stop: () => void
  close: () => void
}

const ABOUT =
  'A local page in the built-in browser pane where Claude draws answers that read better as a picture.'
const SHOW_HINT = '/companion show <absolute path> adds an .html or .md file as a view.'

export function companionPanel(kit: Kit, model: CompanionModel, columns: number): RenderElement {
  const { Button, Text } = kit.t
  return panel(
    kit,
    'companion',
    columns,
    [
      <Text bold color={model.isOpen ? COLORS.spo2 : COLORS.muted}>
        {model.isOpen ? `● Companion open at ${model.url}` : '● Companion closed'}
      </Text>,
      <Text dimColor>{ABOUT}</Text>,
      <Text dimColor>{SHOW_HINT}</Text>,
      buttonRow(kit.t, 'companion-actions', [
        model.isOpen ? (
          <Button key="stop" label="■ Close companion" onPress={model.stop} />
        ) : (
          <Button key="open" variant="primary" label="▶ Open companion" onPress={model.open} />
        ),
      ]),
    ],
    model.close,
  )
}

export function companionPlain(isOpen: boolean, url: string): string[] {
  return [isOpen ? `Companion open at ${url}.` : 'Companion closed.', SHOW_HINT]
}
