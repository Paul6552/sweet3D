import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LABEL_FONT_SIZE, newId, type Label } from '../model/home'
import { dispatch, executeCommand } from '../store/editorStore'
import { collectChanges } from './fields'
import { useLabelFields } from './labelFields'

/** Neuer Text an der angeklickten Stelle im Plan. */
export function LabelDialog({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [draft] = useState<Label>(() => ({
    id: newId('label'),
    text: '',
    x,
    y,
    angle: 0,
    fontSize: DEFAULT_LABEL_FONT_SIZE,
    color: null,
    level: null,
  }))
  const { fields, node } = useLabelFields([draft], true)
  const label = { ...draft, ...collectChanges([draft], fields)[0] }
  const valid = fields.every((f) => f.valid) && label.text.trim() !== ''

  const save = () => {
    if (!valid) return
    executeCommand({ type: 'addItems', labels: [label] })
    dispatch({ type: 'select', ids: [label.id] })
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{t('dialogs.titles.newLabel')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>{node}</DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('projects.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {t('dialogs.ok')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
