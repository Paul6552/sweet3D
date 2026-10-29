import ChairOutlined from '@mui/icons-material/ChairOutlined'
import GridViewOutlined from '@mui/icons-material/GridViewOutlined'
import LibraryAddOutlined from '@mui/icons-material/LibraryAddOutlined'
import Search from '@mui/icons-material/Search'
import ViewListOutlined from '@mui/icons-material/ViewListOutlined'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CatalogPiece } from '../api/catalog'
import { PanelToolbar } from '../editor/PanelFrame'
import { pieceFromCatalog } from '../model/furniture'
import { useResolvedRef } from '../storage/contents'
import { executeCommand, useEditorStore } from '../store/editorStore'
import { CATALOG_PIECE_MIME, useCatalogStore } from './catalogStore'
import { LibrariesDialog } from './LibrariesDialog'

const round = (value: number) => Math.round(value * 10) / 10

/** Filterwert für den Standardkatalog von Sweet Home 3D. */
const BUILTIN = '__builtin'
const ALL = '__all'
const VIEW_KEY = 'sweet3d.catalog.view'

function matches(piece: CatalogPiece, category: string, query: string): boolean {
  if (!query) return true
  const haystack = [piece.name, category, piece.creator ?? '', ...piece.tags].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word))
}

/** Symbol eines Katalogeintrags (Katalog-URL oder importierter Inhalt); ohne Symbol ein Platzhalter. */
export function CatalogIcon({ icon, size }: { icon: string | null; size: number }) {
  const url = useResolvedRef(icon)
  if (!url) return <ChairOutlined sx={{ fontSize: size * 0.6, color: 'text.disabled' }} />
  return <img src={url} alt="" width={size} height={size} style={{ objectFit: 'contain' }} draggable={false} loading="lazy" />
}

function initialView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export function CatalogPanel() {
  const { t, i18n } = useTranslation()
  const { furniture, libraries, error, load } = useCatalogStore()
  const [query, setQuery] = useState('')
  const [library, setLibrary] = useState(ALL)
  const [view, setView] = useState(initialView)
  const [managing, setManaging] = useState(false)
  const pieceCount = useEditorStore((s) => s.home?.furniture.length ?? 0)

  useEffect(() => {
    void load(i18n.resolvedLanguage ?? 'en')
  }, [i18n.resolvedLanguage, load])

  const libraryFilter = libraries.some((l) => l.id === library) || library === BUILTIN ? library : ALL
  const categories = useMemo(
    () =>
      (furniture?.categories ?? [])
        .map((c) => ({
          name: c.name,
          pieces: c.pieces.filter(
            (p) =>
              (libraryFilter === ALL || (libraryFilter === BUILTIN ? !p.libraryId : p.libraryId === libraryFilter)) &&
              matches(p, c.name, query.trim()),
          ),
        }))
        .filter((c) => c.pieces.length > 0),
    [furniture, query, libraryFilter],
  )

  const toggleView = () => {
    const next = view === 'grid' ? 'list' : 'grid'
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Ansicht wird dann nur nicht gemerkt
    }
  }

  // Doppelklick fügt das Möbel versetzt ein; Ziehen in den Plan legt es an der Mausposition ab
  const addToHome = (piece: CatalogPiece) => {
    const offset = (pieceCount % 10) * 30
    executeCommand({ type: 'addItems', furniture: [pieceFromCatalog(piece, 100 + offset, 100 + offset)] })
  }
  const dragProps = (piece: CatalogPiece) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(CATALOG_PIECE_MIME, piece.id)
      e.dataTransfer.effectAllowed = 'copy'
    },
    onDoubleClick: () => addToHome(piece),
    title: `${piece.description ?? piece.name}\n${t('catalog.dimensions', { width: round(piece.width), depth: round(piece.depth), height: round(piece.height) })}`,
  })

  const toolbar = (
    <PanelToolbar>
      <Box sx={{ flex: 1 }} />
      <Tooltip title={t(view === 'grid' ? 'catalog.listView' : 'catalog.gridView')}>
        <IconButton size="small" onClick={toggleView} aria-label={t(view === 'grid' ? 'catalog.listView' : 'catalog.gridView')}>
          {view === 'grid' ? <ViewListOutlined fontSize="small" /> : <GridViewOutlined fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title={t('libraries.manage')}>
        <IconButton size="small" onClick={() => setManaging(true)} aria-label={t('libraries.manage')}>
          <LibraryAddOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </PanelToolbar>
  )

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
      {toolbar}
      {managing && <LibrariesDialog onClose={() => setManaging(false)} />}
      <Box sx={{ p: 1, display: 'flex', gap: 1 }}>
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
        {libraries.length > 0 && (
          <TextField select size="small" value={libraryFilter} onChange={(e) => setLibrary(e.target.value)} sx={{ minWidth: 120, maxWidth: 180 }}>
            <MenuItem value={ALL}>{t('catalog.allLibraries')}</MenuItem>
            <MenuItem value={BUILTIN}>{t('catalog.builtin')}</MenuItem>
            {libraries
              .filter((l) => Object.values(l.furniture).some((c) => c.length > 0))
              .map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
          </TextField>
        )}
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {categories.length === 0 && (
          <Typography sx={{ p: 2 }} color="text.secondary">{t('catalog.noResults')}</Typography>
        )}
        {view === 'grid'
          ? categories.map((category) => (
              <Box key={category.name} sx={{ px: 1, pb: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', py: 0.5, fontWeight: 600 }}
                >
                  {category.name}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 0.5 }}>
                  {category.pieces.map((piece) => (
                    <ButtonBase
                      key={piece.id}
                      {...dragProps(piece)}
                      sx={{
                        flexDirection: 'column',
                        alignItems: 'center',
                        borderRadius: 1,
                        p: 0.5,
                        border: 1,
                        borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                      }}
                    >
                      <Box sx={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f4f4f2', borderRadius: 0.5 }}>
                        <CatalogIcon icon={piece.icon} size={76} />
                      </Box>
                      <Typography variant="caption" sx={{ mt: 0.5, lineHeight: 1.2, textAlign: 'center', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {piece.name}
                      </Typography>
                    </ButtonBase>
                  ))}
                </Box>
              </Box>
            ))
          : (
            <List dense sx={{ pt: 0 }}>
              {categories.map((category) => (
                <li key={category.name}>
                  <ul style={{ padding: 0 }}>
                    <ListSubheader sx={{ lineHeight: '32px' }}>{category.name}</ListSubheader>
                    {category.pieces.map((piece) => (
                      <ListItemButton key={piece.id} {...dragProps(piece)}>
                        <ListItemIcon sx={{ minWidth: 56 }}>
                          <CatalogIcon icon={piece.icon} size={44} />
                        </ListItemIcon>
                        <ListItemText
                          primary={piece.name}
                          secondary={t('catalog.dimensions', { width: round(piece.width), depth: round(piece.depth), height: round(piece.height) })}
                        />
                      </ListItemButton>
                    ))}
                  </ul>
                </li>
              ))}
            </List>
          )}
      </Box>
    </Box>
  )
}
