import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LABEL_FONT_SIZE, type Label } from '../model/home'
import { degrees, show, useNumberField, useSurfaceField, useTextField } from './fields'
import { Grid } from './layout'

/** Felder für Texte; auch im Dialog für einen neuen Text. */
export function useLabelFields(labels: Label[], autoFocus = false) {
  const { t } = useTranslation()
  const text = useTextField(labels, t('dialogs.text'), (l) => l.text, (c, v) => (c.text = v), { multiline: true, required: true, autoFocus })
  const main = [
    useNumberField(labels, t('dialogs.fontSize'), (l) => l.fontSize, (c, v) => (c.fontSize = v ?? DEFAULT_LABEL_FONT_SIZE), { min: 1 }),
    useNumberField(labels, t('dialogs.angle'), (l) => l.angle, (c, v) => (c.angle = v!), degrees),
  ]
  const color = useSurfaceField(labels, t('dialogs.surface.textColor'), (l) => ({ color: l.color, texture: null }), (c, s) => (c.color = s.color), {
    textures: false,
  })
  const node = (
    <Grid>
      <Box sx={{ gridColumn: '1 / -1' }}>{text.node}</Box>
      {show(main)}
      <Box sx={{ gridColumn: '1 / -1' }}>{color.node}</Box>
    </Grid>
  )
  return { fields: [text, ...main, color], node }
}

