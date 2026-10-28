import OpenInNew from '@mui/icons-material/OpenInNew'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openPanelWindow, placementOnScreen, requestScreenDetails, type Placement } from '../sync/windows'
import { panelUrl, useEditorContext } from './EditorContext'
import { useLayoutStore } from './layoutStore'
import type { PanelId } from './panelIds'
import { useNotify } from './useNotify'

/**
 * Löst ein Panel in ein eigenes Fenster. Bei mehreren Bildschirmen (Window Management API)
 * kann der Zielbildschirm gewählt werden, z. B. 3D-Ansicht auf Bildschirm 2.
 */
export function DetachButton({ panel }: { panel: PanelId }) {
  const { t } = useTranslation()
  const notify = useNotify()
  const { projectId, leaderId } = useEditorContext()
  const setDetached = useLayoutStore((s) => s.setDetached)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [screens, setScreens] = useState<ScreenDetails | null>(null)

  const open = (placement: Placement | null) => {
    setAnchor(null)
    if (openPanelWindow(panelUrl(projectId, leaderId, panel), panel, placement)) {
      setDetached(panel, true)
    } else {
      notify(t('panels.popupBlocked'))
    }
  }

  const handleClick = async (event: React.MouseEvent<HTMLElement>) => {
    const button = event.currentTarget
    if (!window.getScreenDetails) {
      open(null)
      return
    }
    // Berechtigung anfragen; die Fensterwahl im Menü ist dann ein neuer Klick (Pop-up erlaubt)
    const details = await requestScreenDetails()
    if (details && details.screens.length > 1) {
      setScreens(details)
      setAnchor(button)
    } else {
      open(null)
    }
  }

  // Andere Bildschirme zuerst, der aktuelle zuletzt
  const sortedScreens = screens
    ? [...screens.screens].sort((a, b) => Number(a === screens.currentScreen) - Number(b === screens.currentScreen))
    : []

  return (
    <>
      <Tooltip title={t('panels.detach')}>
        <IconButton size="small" onClick={(e) => void handleClick(e)} aria-label={t('panels.detach')}>
          <OpenInNew fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {sortedScreens.map((screen, index) => (
          <MenuItem key={`${screen.left},${screen.top}`} onClick={() => open(placementOnScreen(screen))}>
            <ListItemText
              primary={t('panels.detachTo', { screen: screen.label || `#${index + 1}` })}
              secondary={[
                `${screen.width} × ${screen.height}`,
                screen.isPrimary ? t('panels.primaryScreen') : null,
                screen === screens?.currentScreen ? t('panels.currentScreen') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
