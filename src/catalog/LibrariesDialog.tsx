import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddOutlined from '@mui/icons-material/AddOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotify } from '../editor/useNotify'
import { isQuotaError, requestPersistentStorage } from '../storage/projects'
import { measureModel } from '../view3d/modelLoader'
import { librariesChanged, useCatalogStore } from './catalogStore'
import { deleteLibrary, importLibraryFile, LibraryImportFailure, localized, projectsUsingLibrary, type StoredLibrary } from './libraries'

/** Dateien, die als Bibliothek importiert werden können. */
export const LIBRARY_ACCEPT = '.sh3f,.sh3t,.zip,.obj,.glb,.gltf,.dae,.3ds,.kmz,image/*'

function formatSize(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`
}

/** Mitgelieferter Katalog aus public/packs/index.json (erzeugt von scripts/build-packs.mjs). */
interface BundledPack {
  id: string
  file: string
  /** Dateiname der Originalbibliothek, aus dem der Import die Id ableitet. */
  importName?: string
  name: Record<string, string>
  description: Record<string, string>
  size: number
  furniture: number
  textures: number
  provider: string
  license: string
}

/** Liste der mitgelieferten Kataloge; leer, wenn sie nicht erzeugt wurden. */
async function loadPacks(): Promise<BundledPack[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}packs/index.json`)
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return []
    return (await response.json()) as BundledPack[]
  } catch {
    return []
  }
}

/** Anzahl der Möbel bzw. Texturen in der Grundsprache der Bibliothek. */
function itemCount(categories: { pieces?: unknown[]; textures?: unknown[] }[]): number {
  return categories.reduce((sum, c) => sum + (c.pieces?.length ?? c.textures?.length ?? 0), 0)
}

/** Importierte Möbel- und Texturbibliotheken verwalten: importieren, Angaben ansehen, löschen. */
export function LibrariesDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const notify = useNotify()
  const libraries = useCatalogStore((s) => s.libraries)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ library: StoredLibrary; projects: string[] } | null>(null)
  const [packs, setPacks] = useState<BundledPack[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const language = i18n.resolvedLanguage === 'de' ? 'de' : 'en'
  const installed = new Set(libraries.map((l) => l.id))

  useEffect(() => {
    void loadPacks().then(setPacks)
  }, [])

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    requestPersistentStorage()
    try {
      for (const file of files) {
        try {
          const result = await importLibraryFile(file, measureModel)
          notify(t('libraries.imported', { name: result.library.name, furniture: result.furniture, textures: result.textures }))
        } catch (e) {
          if (e instanceof LibraryImportFailure) setError(t(`libraries.errors.${e.reason}`, { file: file.name }))
          else if (isQuotaError(e)) setError(t('libraries.errors.quota'))
          else {
            console.error('Bibliothek konnte nicht importiert werden', e)
            setError(t('libraries.errors.invalid', { file: file.name }))
          }
        }
      }
      await librariesChanged()
    } finally {
      setBusy(false)
    }
  }

  const addPack = async (pack: BundledPack) => {
    setAdding(pack.id)
    setError(null)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}packs/${pack.file}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await importFiles([new File([await response.blob()], pack.importName ?? pack.file)])
    } catch (e) {
      console.error('Katalog konnte nicht geladen werden', e)
      setError(t('libraries.errors.invalid', { file: pack.name[language] }))
    } finally {
      setAdding(null)
    }
  }

  const askDelete = async (library: StoredLibrary) => setConfirm({ library, projects: await projectsUsingLibrary(library.id) })
  const doDelete = async () => {
    if (!confirm) return
    setConfirm(null)
    await deleteLibrary(confirm.library.id)
    await librariesChanged()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('libraries.title')}</DialogTitle>
      <DialogContent dividers>
        <Box
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void importFiles([...e.dataTransfer.files])
          }}
          sx={{
            border: 2,
            borderStyle: 'dashed',
            borderColor: dragging ? 'primary.main' : 'divider',
            borderRadius: 1,
            p: 2,
            mb: 2,
            textAlign: 'center',
            bgcolor: dragging ? 'action.hover' : 'transparent',
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('libraries.dropHint')}
          </Typography>
          <Button component="label" variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <UploadFileOutlined />} disabled={busy}>
            {t('libraries.import')}
            <input
              hidden
              multiple
              type="file"
              accept={LIBRARY_ACCEPT}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                void importFiles(files)
              }}
            />
          </Button>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t('libraries.sources')}{' '}
            <Link href="https://www.sweethome3d.com/freeModels.jsp" target="_blank" rel="noreferrer">
              sweethome3d.com
            </Link>
            {' · '}
            <Link href="https://polyhaven.com/textures" target="_blank" rel="noreferrer">
              Poly Haven
            </Link>
            {' · '}
            <Link href="https://ambientcg.com/" target="_blank" rel="noreferrer">
              ambientCG
            </Link>
          </Typography>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {confirm && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <>
                <Button color="inherit" size="small" onClick={() => setConfirm(null)}>
                  {t('projects.cancel')}
                </Button>
                <Button color="inherit" size="small" onClick={() => void doDelete()}>
                  {t('projects.delete')}
                </Button>
              </>
            }
          >
            {confirm.projects.length > 0
              ? t('libraries.deleteUsed', { name: confirm.library.name, projects: confirm.projects.join(', ') })
              : t('libraries.deleteConfirm', { name: confirm.library.name })}
          </Alert>
        )}
        {packs.length > 0 && (
          <>
            <Typography variant="subtitle2">{t('libraries.bundled')}</Typography>
            <List dense disablePadding sx={{ mb: 2 }}>
              {packs.map((pack) => (
                <ListItem
                  key={pack.id}
                  divider
                  secondaryAction={
                    installed.has(pack.id) ? (
                      <Tooltip title={t('libraries.installed')}>
                        <CheckOutlined fontSize="small" color="success" sx={{ mr: 1 }} />
                      </Tooltip>
                    ) : (
                      <Button
                        size="small"
                        startIcon={adding === pack.id ? <CircularProgress size={14} /> : <AddOutlined />}
                        disabled={busy || adding !== null}
                        onClick={() => void addPack(pack)}
                      >
                        {t('libraries.add')}
                      </Button>
                    )
                  }
                >
                  <ListItemText
                    sx={{ pr: 12 }}
                    primary={pack.name[language] ?? pack.name.en}
                    secondary={[
                      t('libraries.counts', { furniture: pack.furniture, textures: pack.textures }),
                      formatSize(pack.size),
                      pack.provider,
                      pack.license && t('libraries.license', { license: pack.license }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItem>
              ))}
            </List>
            <Typography variant="subtitle2">{t('libraries.own')}</Typography>
          </>
        )}
        {libraries.length === 0 ? (
          <Typography color="text.secondary">{t('libraries.none')}</Typography>
        ) : (
          <List dense disablePadding>
            {libraries.map((library) => (
              <ListItem
                key={library.id}
                divider
                secondaryAction={
                  <Tooltip title={t('projects.delete')}>
                    <IconButton edge="end" onClick={() => void askDelete(library)} aria-label={t('projects.delete')}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText
                  primary={`${library.name}${library.version ? ` ${library.version}` : ''}`}
                  secondary={[
                    t('libraries.counts', { furniture: itemCount(localized(library.furniture, '')), textures: itemCount(localized(library.textures, '')) }),
                    formatSize(library.size),
                    library.provider,
                    library.license && t('libraries.license', { license: library.license }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('photo.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
