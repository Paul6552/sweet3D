import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { de } from './de'
import { en } from './en'

export const LANGUAGES = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']

// Nur eine bewusst gewählte Sprache wird gespeichert, sonst gilt jeweils die aktuelle Browsersprache
const STORAGE_KEY = 'sweet3d-language'

/** Die gespeicherte Sprachwahl, null: Browsersprache. */
export function chosenLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.some((l) => l.code === value) ? (value as Language) : null
  } catch {
    return null
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { de: { translation: de }, en: { translation: en } },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: STORAGE_KEY, caches: [] },
    interpolation: { escapeValue: false },
  })

const syncHtmlLang = () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
}
syncHtmlLang()
i18n.on('languageChanged', syncHtmlLang)

/** Die Sprache, die ohne eigene Wahl gilt: erste unterstützte Browsersprache, sonst Englisch. */
export function browserLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = LANGUAGES.find((l) => tag.toLowerCase().split('-')[0] === l.code)
    if (match) return match.code
  }
  return 'en'
}

/** Setzt die Sprache für alle Fenster; null kehrt zur Browsersprache zurück. */
export function chooseLanguage(language: Language | null) {
  try {
    if (language) localStorage.setItem(STORAGE_KEY, language)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ohne Speicher gilt die Wahl nur für dieses Fenster
  }
  void i18n.changeLanguage(language ?? undefined)
}

// Herausgelöste Panel-Fenster übernehmen eine Sprachwahl aus dem Hauptfenster
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) void i18n.changeLanguage(chosenLanguage() ?? undefined)
})

export default i18n
