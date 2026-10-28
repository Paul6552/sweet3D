import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { EditorPage } from './editor/EditorPage'
import { PanelWindowPage } from './editor/PanelWindowPage'
import i18n from './i18n'
import { createProject, lastProjectId, listProjects } from './storage/projects'

const rootRoute = createRootRoute({ component: Outlet })

/** Startseite: öffnet das zuletzt bearbeitete Projekt bzw. legt beim ersten Start eines an. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    const last = lastProjectId()
    const projects = await listProjects()
    const existing = projects.find((p) => p.id === last) ?? projects[0]
    const projectId = existing?.id ?? (await createProject(i18n.t('projects.defaultName'))).id
    throw redirect({ to: '/editor/$projectId', params: { projectId }, replace: true })
  },
})

const editorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor/$projectId', component: EditorPage })

/** Herausgelöstes Panel; {@code leader} identifiziert das zugehörige Editor-Hauptfenster. */
const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor/$projectId/panel/$panelId',
  validateSearch: (search: Record<string, unknown>) => ({ leader: String(search.leader ?? '') }),
  component: PanelWindowPage,
})

const routeTree = rootRoute.addChildren([indexRoute, editorRoute, panelRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
