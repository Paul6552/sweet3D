import Search from '@mui/icons-material/Search'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CatalogPiece } from '../api/catalog'
import { pieceFromCatalog } from '../model/furniture'
import { executeCommand, useEditorStore } from '../store/editorStore'
import { CATALOG_PIECE_MIME, useCatalogStore } from './catalogStore'

const round = (value: number) => Math.round(value * 10) / 10

function matches(piece: CatalogPiece, category: string, query: string): boolean {
  if (!query) return true
  const haystack = [piece.name, category, piece.creator ?? '', ...piece.tags].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

export function CatalogPanel() {
  const { t, i18n } = useTranslation()
  const { furniture, error, load } = useCatalogStore()
  const [query, setQuery] = useState('')
  const pieceCount = useEditorStore((s) => s.home?.furniture.length ?? 0)

  useEffect(() => {
    void load(i18n.resolvedLanguage ?? 'de')
  }, [i18n.resolvedLanguage, load])

  const categories = useMemo(
    () =>
      (furniture?.categories ?? [])
        .map((c) => ({ name: c.name, pieces: c.pieces.filter((p) => matches(p, c.name, query.trim())) }))
        .filter((c) => c.pieces.length > 0),
    [furniture, query],
  )

  // Bis der 2D-Plan (Phase 3) Drag & Drop unterstützt, fügt ein Doppelklick das Möbel versetzt ein
  const addToHome = (piece: CatalogPiece) => {
    const offset = (pieceCount % 10) * 30
    executeCommand({ type: 'addItems', furniture: [pieceFromCatalog(piece, 100 + offset, 100 + offset)] })
  }

  if (error) {
    return <Typography sx={{ p: 2 }} color="error">{t('catalog.error')}</Typography>
  }
  if (!furniture) {
    return (
      <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
        <CircularProgress size={16} /> {t('catalog.loading')}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={t('catalog.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <List dense sx={{ flex: 1, overflow: 'auto', pt: 0 }}>
        {categories.length === 0 && (
          <Typography sx={{ p: 2 }} color="text.secondary">{t('catalog.noResults')}</Typography>
        )}
        {categories.map((category) => (
          <li key={category.name}>
            <ul style={{ padding: 0 }}>
              <ListSubheader sx={{ lineHeight: '32px' }}>{category.name}</ListSubheader>
              {category.pieces.map((piece) => (
                <ListItemButton
                  key={piece.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CATALOG_PIECE_MIME, piece.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => addToHome(piece)}
                  title={piece.description ?? piece.name}
                >
                  <ListItemIcon sx={{ minWidth: 48 }}>
                    {piece.icon && (
                      <img src={piece.icon} alt="" width={36} height={36} style={{ objectFit: 'contain' }} draggable={false} />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={piece.name}
                    secondary={t('catalog.dimensions', {
                      width: round(piece.width),
                      depth: round(piece.depth),
                      height: round(piece.height),
                    })}
                  />
                </ListItemButton>
              ))}
            </ul>
          </li>
        ))}
      </List>
    </Box>
  )
}
