export type Mode = 'mock' | 'live'

export const API_MODE: Mode = process.env.NEXT_PUBLIC_API_MODE === 'live' ? 'live' : 'mock'
export const TIDE_MODE: Mode = process.env.NEXT_PUBLIC_TIDE_MODE === 'live' ? 'live' : 'mock'
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000/ws'
export const MOCKS_BASE = '/mocks'
