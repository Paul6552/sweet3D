import { ItemDialog } from './ItemDialog'
import { LabelDialog } from './LabelDialog'
import { useDialogStore } from './dialogStore'

/** Zeigt den angeforderten Eigenschaftsdialog; einmal je Fenster eingebunden. */
export function DialogHost() {
  const request = useDialogStore((s) => s.request)
  const close = useDialogStore((s) => s.close)
  if (!request) return null
  return request.kind === 'edit' ? (
    <ItemDialog key={request.ids.join()} ids={request.ids} onClose={close} />
  ) : (
    <LabelDialog key={`${request.x},${request.y}`} x={request.x} y={request.y} onClose={close} />
  )
}
