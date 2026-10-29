import Check from '@mui/icons-material/Check'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { browserLanguage, chooseLanguage, chosenLanguage, LANGUAGES, type Language } from '../i18n'

/** Einstellungen in der Titelzeile, derzeit die Sprache der Oberfläche. */
export function SettingsMenu() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // Beim Öffnen gelesen, damit auch eine Wahl aus einem anderen Fenster stimmt
  const [chosen, setChosen] = useState<Language | null>(null)
  const auto = LANGUAGES.find((l) => l.code === browserLanguage())?.name

  const select = (language: Language | null) => {
    setAnchor(null)
    chooseLanguage(language)
  }

  const item = (language: Language | null, label: string) => (
    <MenuItem key={language ?? 'auto'} selected={chosen === language} onClick={() => select(language)}>
      <ListItemIcon>{chosen === language && <Check fontSize="small" />}</ListItemIcon>
      <ListItemText lang={language ?? undefined}>{label}</ListItemText>
    </MenuItem>
  )

  return (
    <>
      <Tooltip title={t('editor.settings')}>
        <IconButton
          size="small"
          onClick={(e) => {
            setChosen(chosenLanguage())
            setAnchor(e.currentTarget)
          }}
          aria-label={t('editor.settings')}
        >
          <SettingsOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <ListSubheader>{t('editor.language')}</ListSubheader>
        {item(null, t('editor.languageAuto', { language: auto }))}
        {LANGUAGES.map((l) => item(l.code, l.name))}
      </Menu>
    </>
  )
}
