import Add from '@mui/icons-material/Add'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Level } from '../model/home'
import { newLevels } from '../model/levels'
import { dispatch, executeCommand, useEditorStore } from '../store/editorStore'

/**
 * Reiter der Ebenen über dem Plan wie in Sweet Home 3D: Klick wählt, Doppelklick ändert,
 * „+“ legt eine Ebene über der obersten an (unter dem Dach-Niveau). Ohne Ebenen zeigt sich nur das „+“.
 */
export function LevelTabs() {
  const { t } = useTranslation()
  const levels = useEditorStore((s) => s.home!.levels)
  const selected = useEditorStore((s) => s.home!.selectedLevel)
  const [editing, setEditing] = useState<Level | null>(null)

  const add = () => {
    const { levels: created, base } = newLevels(useEditorStore.getState().home!, (n) => t('levels.defaultName', { n }))
    executeCommand({ type: 'addLevels', levels: created, assignExistingTo: base?.id ?? null })
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', minHeight: 32 }}>
      {levels.length > 0 && (
        <Tabs
          value={levels.some((l) => l.id === selected) ? selected : false}
          onChange={(_, id: string) => dispatch({ type: 'selectLevel', id })}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, textTransform: 'none' } }}
        >
          {levels.map((level) => (
            <Tab
              key={level.id}
              value={level.id}
              label={level.name}
              onDoubleClick={() => setEditing(level)}
              sx={{ opacity: level.viewable ? 1 : 0.5 }}
            />
          ))}
        </Tabs>
      )}
      <Tooltip title={levels.length > 0 ? `${t('levels.add')} · ${t('levels.editHint')}` : t('levels.add')}>
        <IconButton size="small" onClick={add} aria-label={t('levels.add')} sx={{ mx: 0.5 }}>
          <Add fontSize="small" />
        </IconButton>
      </Tooltip>
      {editing && <LevelDialog level={editing} onClose={() => setEditing(null)} />}
    </Box>
  )
}

function LevelDialog({ level, onClose }: { level: Level; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(level.name)
  const [elevation, setElevation] = useState(String(level.elevation))
  const [height, setHeight] = useState(String(level.height))
  const [floorThickness, setFloorThickness] = useState(String(level.floorThickness))
  const [viewable, setViewable] = useState(level.viewable)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const parsed = {
    elevation: Number.parseFloat(elevation.replace(',', '.')),
    height: Number.parseFloat(height.replace(',', '.')),
    floorThickness: Number.parseFloat(floorThickness.replace(',', '.')),
  }
  const valid = name.trim() !== '' && Number.isFinite(parsed.elevation) && parsed.height > 0 && parsed.floorThickness >= 0

  const save = () => {
    if (!valid) return
    executeCommand({ type: 'updateLevel', change: { id: level.id, name: name.trim(), viewable, ...parsed } })
    onClose()
  }

  const number = (label: string, value: string, set: (v: string) => void) => (
    <TextField
      fullWidth
      margin="dense"
      label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: 'cm' } }}
    />
  )

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <DialogTitle>{t('levels.edit')}</DialogTitle>
        <DialogContent>
          {confirmDelete ? (
            t('levels.deleteConfirm', { name: level.name })
          ) : (
            <>
              <TextField autoFocus fullWidth margin="dense" label={t('levels.name')} value={name} onChange={(e) => setName(e.target.value)} />
              {number(t('levels.elevation'), elevation, setElevation)}
              {number(t('levels.height'), height, setHeight)}
              {number(t('levels.floorThickness'), floorThickness, setFloorThickness)}
              <FormControlLabel control={<Switch checked={viewable} onChange={(e) => setViewable(e.target.checked)} />} label={t('levels.viewable')} />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {confirmDelete ? (
            <>
              <Button onClick={() => setConfirmDelete(false)}>{t('projects.cancel')}</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  executeCommand({ type: 'deleteLevel', id: level.id })
                  onClose()
                }}
              >
                {t('levels.delete')}
              </Button>
            </>
          ) : (
            <>
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                {t('levels.delete')}
              </Button>
              <Box>
                <Button onClick={onClose}>{t('projects.cancel')}</Button>
                <Button type="submit" variant="contained" disabled={!valid}>
                  {t('projects.save')}
                </Button>
              </Box>
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
