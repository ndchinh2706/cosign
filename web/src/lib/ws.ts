'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadMock } from './api'
import { API_MODE, TIDE_MODE, WS_URL } from './config'
import { getDemoUser } from './users'

export type Envelope<P = Record<string, unknown>> = {
  v: 1
  id: string
  ts: string
  type: string
  channel: string | null
  payload: P
  beat?: string
}

type Handler = (e: Envelope) => void
type Status = 'idle' | 'connecting' | 'open' | 'closed'

export type SocketOptions = {
  console?: boolean
  getToken?: () => Promise<string | null> // live Tide mode
  replayIntervalMs?: number // mock mode autoplay speed
}

const envelope = (type: string, payload: Record<string, unknown>): Envelope => ({
  v: 1,
  id: `c_${Math.random().toString(36).slice(2, 10)}`,
  ts: new Date().toISOString(),
  type,
  channel: null,
  payload,
})

/**
 * live: one WS per tab, `auth` first (docs/API.md §6), then subscribe.
 * mock: replays docs/mocks/ws/storyboard.json in array order (not by ts); every event is delivered.
 */
export function useCosignSocket(channels: string[], opts: SocketOptions = {}) {
  const handlers = useRef(new Map<string, Set<Handler>>())
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [lastEvent, setLastEvent] = useState<Envelope | null>(null)
  const channelKey = channels.join(',')
  const { console: isConsole = false, getToken, replayIntervalMs = 1500 } = opts

  const dispatch = useCallback((e: Envelope) => {
    setLastEvent(e)
    handlers.current.get(e.type)?.forEach((h) => h(e))
    handlers.current.get('*')?.forEach((h) => h(e))
  }, [])

  const on = useCallback((type: string, handler: Handler) => {
    if (!handlers.current.has(type)) handlers.current.set(type, new Set())
    handlers.current.get(type)!.add(handler)
    return () => {
      handlers.current.get(type)?.delete(handler)
    }
  }, [])

  const send = useCallback((type: string, payload: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(envelope(type, payload)))
  }, [])

  // live
  useEffect(() => {
    if (API_MODE !== 'live') return
    let closed = false
    let ping: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = async () => {
      setStatus('connecting')
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen = async () => {
        const token = TIDE_MODE === 'live' && getToken ? await getToken() : null
        ws.send(JSON.stringify(envelope('auth', token ? { token } : { demo_user: getDemoUser() })))
      }
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data) as Envelope
        if (e.type === 'auth_ok') {
          setStatus('open')
          ws.send(JSON.stringify(envelope('subscribe', { channels: channelKey ? channelKey.split(',') : [], console: isConsole })))
          ping = setInterval(() => ws.send(JSON.stringify(envelope('ping', {}))), 25_000)
        }
        dispatch(e)
      }
      ws.onclose = () => {
        clearInterval(ping)
        setStatus('closed')
        // Caller should refetch REST snapshots on reconnect (server does not replay).
        if (!closed) retry = setTimeout(connect, 2000)
      }
    }
    void connect()
    return () => {
      closed = true
      clearInterval(ping)
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [channelKey, isConsole, getToken, dispatch])

  // mock replay
  const story = useRef<Envelope[]>([])
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (API_MODE !== 'mock') return
    loadMock<Envelope[]>('ws/storyboard.json').then((events) => {
      story.current = events
      setTotal(events.length)
      setStatus('open')
    })
  }, [])

  const step = useCallback(() => {
    setIndex((i) => {
      const e = story.current[i]
      if (e) dispatch(e)
      return e ? i + 1 : i
    })
  }, [dispatch])

  useEffect(() => {
    if (API_MODE !== 'mock' || !playing) return
    const t = setInterval(step, replayIntervalMs)
    return () => clearInterval(t)
  }, [playing, step, replayIntervalMs])

  const replay = {
    index,
    total,
    playing,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    step,
    reset: () => {
      setPlaying(false)
      setIndex(0)
    },
  }

  return { status, on, send, lastEvent, replay }
}
