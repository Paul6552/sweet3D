import axios from 'axios'
import { accessToken } from '../auth/keycloak'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(async (config) => {
  config.headers.Authorization = `Bearer ${await accessToken()}`
  return config
})
