import Keycloak from 'keycloak-js'

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
})

/** Meldet den Nutzer an (Weiterleitung zu Keycloak, falls noch keine Sitzung besteht). */
export async function initAuth(): Promise<void> {
  await keycloak.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    checkLoginIframe: false,
  })
}

/** Liefert ein gültiges Access-Token und erneuert es bei Bedarf. */
export async function accessToken(): Promise<string> {
  try {
    await keycloak.updateToken(30)
  } catch {
    await keycloak.login()
  }
  return keycloak.token!
}

export function logout(): void {
  void keycloak.logout({ redirectUri: window.location.origin })
}

export function displayName(): string {
  const token = keycloak.tokenParsed as { name?: string; preferred_username?: string } | undefined
  return token?.name ?? token?.preferred_username ?? ''
}
