// Window Management API (Chrome/Edge), noch nicht in lib.dom enthalten
interface ScreenDetailed extends Screen {
  readonly availLeft: number
  readonly availTop: number
  readonly left: number
  readonly top: number
  readonly isPrimary: boolean
  readonly isInternal: boolean
  readonly label: string
}

interface ScreenDetails extends EventTarget {
  readonly screens: readonly ScreenDetailed[]
  readonly currentScreen: ScreenDetailed
}

interface Window {
  getScreenDetails?: () => Promise<ScreenDetails>
}
