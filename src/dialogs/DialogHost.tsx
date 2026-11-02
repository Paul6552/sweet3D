import { BackgroundImageDialog } from './BackgroundImageDialog'
import { CompassDialog } from './CompassDialog'
import { EnvironmentDialog } from './EnvironmentDialog'
import { ItemDialog } from './ItemDialog'
import { LabelDialog } from './LabelDialog'
import { useDialogStore } from './dialogStore'

/** Zeigt den angeforderten Eigenschaftsdialog; einmal je Fenster eingebunden. */
export function DialogHost() {
  const request = useDialogStore((s) => s.request)
  const close = useDialogStore((s) => s.close)
  if (!request) return null
  switch (request.kind) {
    case 'edit':
      return <ItemDialog key={request.ids.join()} ids={request.ids} onClose={close} />
    case 'newLabel':
      return <LabelDialog key={`${request.x},${request.y}`} x={request.x} y={request.y} onClose={close} />
    case 'compass':
      return <CompassDialog onClose={close} />
    case 'environment':
      return <EnvironmentDialog onClose={close} />
    case 'backgroundImage':
      return <BackgroundImageDialog onClose={close} />
  }
}
