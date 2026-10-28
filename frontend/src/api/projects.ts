import { api } from './client'

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  version: number
}

export interface ProjectDetail extends ProjectSummary {
  /** Inhalt im Format von {@link import('../model/home').Home}; bei neuen Projekten leer. */
  home: unknown
}

export const projectsApi = {
  list: () => api.get<ProjectSummary[]>('/projects').then((r) => r.data),
  get: (id: string) => api.get<ProjectDetail>(`/projects/${id}`).then((r) => r.data),
  create: (name: string) => api.post<ProjectDetail>('/projects', { name }).then((r) => r.data),
  update: (id: string, change: { name?: string; home?: unknown; version: number }) =>
    api.put<ProjectDetail>(`/projects/${id}`, change).then((r) => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`),
}
