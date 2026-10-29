import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { catalogApi, type TexturesCatalog } from '../api/catalog'
import { argbToCss, cssToArgb } from '../model/colors'
import { CONTENT_PREFIX } from '../model/contents'
import type { Home, Surface, TextureRef } from '../model/home'
import { useResolvedRef } from '../storage/contents'
import { saveContents } from '../storage/projects'
import { useEditorStore } from '../store/editorStore'

type Mode = 'default' | 'color' | 'texture'

const modeOf = (surface: Surface | undefined): Mode | null =>
  surface === undefined ? null : surface.texture ? 'texture' : surface.color !== null ? 'color' : 'default'

const DEFAULT_COLOR = cssToArgb('#d0d0d0')

/** Auswahl Standard / Farbe / Textur für eine Fläche; {@code value} undefined = verschiedene Werte. */
export function SurfaceEditor({
  label,
  value,
  onChange,
  textures,
}: {
  label: string
  value: Surface | undefined
  onChange: (surface: Surface) => void
  textures: boolean
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  // Zuletzt gewählte Farbe bzw. Textur, damit das Hin- und Herschalten nichts verliert
  const [lastColor, setLastColor] = useState(value?.color ?? DEFAULT_COLOR)
  const [lastTexture, setLastTexture] = useState<TextureRef | null>(value?.texture ?? null)
  const mode = modeOf(value)

  const setMode = (next: Mode | null) => {
    if (next === 'default') onChange({ color: null, texture: null })
    else if (next === 'color') onChange({ color: lastColor, texture: null })
    else if (next === 'texture') {
      if (lastTexture) onChange({ color: null, texture: lastTexture })
      else setPicking(true)
    }
  }
  const pickTexture = (texture: TextureRef) => {
    setLastTexture(texture)
    onChange({ color: null, texture })
    setPicking(false)
  }
  const setTextureSize = (key: 'width' | 'height', text: string) => {
    const size = Number.parseFloat(text.replace(',', '.'))
    if (value?.texture && size > 0) pickTexture({ ...value.texture, [key]: size })
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, next: Mode | null) => next && setMode(next)}>
          <ToggleButton value="default">{t('dialogs.surface.default')}</ToggleButton>
          <ToggleButton value="color">{t('dialogs.surface.color')}</ToggleButton>
          {textures && <ToggleButton value="texture">{t('dialogs.surface.texture')}</ToggleButton>}
        </ToggleButtonGroup>
        {mode === 'color' && value?.color != null && (
          <input
            type="color"
            aria-label={t('dialogs.surface.color')}
            value={argbToCss(value.color)}
            onChange={(e) => {
              const color = cssToArgb(e.target.value)
              setLastColor(color)
              onChange({ color, texture: null })
            }}
            style={{ width: 44, height: 32, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
          />
        )}
        {mode === 'texture' && value?.texture && (
          <>
            <Tooltip title={t('dialogs.surface.choose')}>
              <ButtonBase onClick={() => setPicking(true)} sx={{ borderRadius: 1, overflow: 'hidden' }}>
                <TextureThumb texture={value.texture} size={32} />
              </ButtonBase>
            </Tooltip>
            <TextField
              key={`w${value.texture.width}`}
              size="small"
              label={t('dialogs.surface.width')}
              defaultValue={Math.round(value.texture.width * 10) / 10}
              onBlur={(e) => setTextureSize('width', e.target.value)}
              sx={{ width: 96 }}
              slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: 'cm' } }}
            />
            <TextField
              key={`h${value.texture.height}`}
              size="small"
              label={t('dialogs.surface.height')}
              defaultValue={Math.round(value.texture.height * 10) / 10}
              onBlur={(e) => setTextureSize('height', e.target.value)}
              sx={{ width: 96 }}
              slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: 'cm' } }}
            />
          </>
        )}
      </Stack>
      {picking && <TexturePicker onPick={pickTexture} onClose={() => setPicking(false)} />}
    </Box>
  )
}

export function TextureThumb({ texture, size }: { texture: TextureRef; size: number }) {
  const url = useResolvedRef(texture.image)
  return (
    <Box
      component={url ? 'img' : 'div'}
      src={url ?? undefined}
      alt=""
      title={texture.name}
      sx={{ width: size, height: size, display: 'block', objectFit: 'cover', bgcolor: 'action.hover' }}
    />
  )
}

/** Texturen, die das Projekt schon verwendet (z. B. aus einer importierten .sh3d-Datei). */
function usedTextures(home: Home): TextureRef[] {
  const all = [
    ...home.walls.flatMap((w) => [w.leftSide?.texture, w.rightSide?.texture]),
    ...home.rooms.flatMap((r) => [r.floor?.texture, r.ceiling?.texture]),
    ...home.furniture.map((p) => p.texture),
  ].filter((texture): texture is TextureRef => !!texture)
  return [...new Map(all.map((texture) => [texture.image, texture])).values()]
}

function TexturePicker({ onPick, onClose }: { onPick: (texture: TextureRef) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [catalog, setCatalog] = useState<TexturesCatalog | null>(null)
  const [uploading, setUploading] = useState(false)
  const home = useEditorStore((s) => s.home)
  const used = useMemo(() => (home ? usedTextures(home) : []), [home])

  useEffect(() => {
    let cancelled = false
    void catalogApi
      .textures(i18n.language)
      .then((c) => !cancelled && setCatalog(c))
      .catch(() => !cancelled && setCatalog({ language: '', categories: [] }))
    return () => {
      cancelled = true
    }
  }, [i18n.language])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const key = crypto.randomUUID()
      await saveContents({ [key]: file })
      onPick({ catalogId: null, name: file.name.replace(/\.[^.]+$/, ''), image: `${CONTENT_PREFIX}${key}`, width: 100, height: 100 })
    } finally {
      setUploading(false)
    }
  }

  const groups: { name: string; textures: TextureRef[] }[] = [
    ...(used.length > 0 ? [{ name: t('dialogs.surface.used'), textures: used }] : []),
    ...(catalog?.categories ?? []).map((category) => ({
      name: category.name,
      textures: category.textures.map((x) => ({ catalogId: x.id, name: x.name, image: x.image, width: x.width, height: x.height })),
    })),
  ]

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dialogs.surface.choose')}</DialogTitle>
      <DialogContent dividers>
        {!catalog && <CircularProgress size={24} />}
        {groups.map((group) => (
          <Box key={group.name} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {group.name}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 1 }}>
              {group.textures.map((texture) => (
                <ButtonBase
                  key={texture.image}
                  onClick={() => onPick(texture)}
                  sx={{ flexDirection: 'column', alignItems: 'stretch', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <TextureThumb texture={texture} size={64} />
                  <Typography variant="caption" noWrap sx={{ maxWidth: 72 }}>
                    {texture.name}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button component="label" startIcon={uploading ? <CircularProgress size={16} /> : <UploadFileOutlined />} disabled={uploading}>
          {t('dialogs.surface.upload')}
          <input
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
        </Button>
        <Button onClick={onClose}>{t('projects.cancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}
