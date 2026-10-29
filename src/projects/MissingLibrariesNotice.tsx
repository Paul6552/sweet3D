import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCatalogStore } from '../catalog/catalogStore'
import { LibrariesDialog } from '../catalog/LibrariesDialog'
import { usedLibraryIds } from '../catalog/libraries'
import { useEditorStore } from '../store/editorStore'

/**
 * Hinweis, wenn das Projekt Möbel oder Texturen aus benutzerdefinierten Katalogen verwendet, die in
 * diesem Browser nicht installiert sind (z. B. eine weitergegebene .sh3d-Datei). Das Projekt wird
 * trotzdem richtig angezeigt, weil die Modelle in der Datei stecken; nur weitere Einträge aus dem
 * Katalog lassen sich erst nach dessen Import verwenden.
 */
export function MissingLibrariesNotice({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const libraries = useCatalogStore((s) => s.libraries)
  const loaded = useCatalogStore((s) => s.furniture !== null)
  const load = useCatalogStore((s) => s.load)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void load(i18n.resolvedLanguage ?? 'de')
  }, [i18n.resolvedLanguage, load])

  const home = useEditorStore((s) => s.home)
  const missing = useMemo(() => {
    if (!loaded || !home) return []
    const installed = new Set(libraries.map((l) => l.id))
    const known = new Map((home.libraries ?? []).map((l) => [l.id, l]))
    // Nur Bibliotheken, aus denen das Projekt noch etwas verwendet
    return [...usedLibraryIds(home)]
      .filter((id) => !installed.has(id))
      .map((id) => known.get(id) ?? { id, name: id, version: null, provider: null, source: null })
  }, [loaded, libraries, home])

  if (missing.length === 0 || dismissed === projectId) return null
  return (
    <>
      <Alert
        severity="info"
        square
        onClose={() => setDismissed(projectId)}
        action={
          <Button color="inherit" size="small" onClick={() => setImporting(true)}>
            {t('libraries.importMissing')}
          </Button>
        }
      >
        {missing.length === 1 ? t('libraries.missingOne') : t('libraries.missingMany', { count: missing.length })}{' '}
        {missing
          .map((l) =>
            [
              `„${l.name}“`,
              l.version && t('libraries.version', { version: l.version }),
              l.provider && t('libraries.from', { provider: l.provider }),
              l.source && `(${l.source})`,
            ]
              .filter(Boolean)
              .join(' '),
          )
          .join(', ')}
        {'. '}
        {t('libraries.missingHint')}
      </Alert>
      {importing && <LibrariesDialog onClose={() => setImporting(false)} />}
    </>
  )
}
