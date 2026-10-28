import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { EditorPage } from './editor/EditorPage'
import { PanelWindowPage } from './editor/PanelWindowPage'
import { ProjectsPage } from './projects/ProjectsPage'

const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})

const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsPage })

const editorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/editor/$projectId', component: EditorPage })

/** Herausgelöstes Panel; {@code leader} identifiziert das zugehörige Editor-Hauptfenster. */
const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor/$projectId/panel/$panelId',
  validateSearch: (search: Record<string, unknown>) => ({ leader: String(search.leader ?? '') }),
  component: PanelWindowPage,
})

const routeTree = rootRoute.addChildren([indexRoute, projectsRoute, editorRoute, panelRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
