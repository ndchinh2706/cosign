'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getAuthToken, loadMock } from './api'
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
 * mock: subscribes to the shared storyboard replay below (array order, not by ts); every event is delivered.
 */
export function useCosignSocket(channels: string[], opts: SocketOptions = {}) {
  const handlers = useRef(new Map<string, Set<Handler>>())
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [lastEvent, setLastEvent] = useState<Envelope | null>(null)
  const channelKey = channels.join(',')
  const { console: isConsole = false, getToken = getAuthToken } = opts

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
        const token = TIDE_MODE === 'live' ? await getToken() : null
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

  // mock: every hook in the tab listens to the one shared replay
  useEffect(() => {
    if (API_MODE !== 'mock') return
    void loadStory()
    sinks.add(dispatch)
    return () => {
      sinks.delete(dispatch)
    }
  }, [dispatch])

  return { status: API_MODE === 'mock' ? 'open' : status, on, send, lastEvent }
}

// Mock replay of docs/mocks/ws/storyboard.json, shared per tab and driven from RoleSwitcher.
// ponytail: ignores channels, so every hook sees every event; filter by channel if a screen double-counts.
const REPLAY_MS = 1000
const story = { events: [] as Envelope[], index: 0, mode: null as 'beat' | 'all' | null, timer: undefined as ReturnType<typeof setInterval> | undefined }
const sinks = new Set<Handler>()
const replayListeners = new Set<() => void>()
let loading: Promise<void> | null = null
let snap = { index: 0, total: 0, beat: null as string | null, playing: false }

const loadStory = () =>
  (loading ??= loadMock<Envelope[]>('ws/storyboard.json').then((events) => {
    story.events = events
    emit()
  }))

function emit() {
  const { events, index, mode } = story
  snap = { index, total: events.length, beat: events[index]?.beat ?? null, playing: mode !== null }
  replayListeners.forEach((l) => l())
}

function stop() {
  clearInterval(story.timer)
  story.mode = null
  emit()
}

function tick() {
  const e = story.events[story.index]
  if (!e) return stop()
  story.index++
  sinks.forEach((s) => s(e))
  const next = story.events[story.index]
  if (!next || (story.mode === 'beat' && next.beat !== e.beat)) stop()
  else emit()
}

function start(mode: 'beat' | 'all') {
  clearInterval(story.timer)
  story.mode = mode
  tick()
  if (story.mode) story.timer = setInterval(tick, REPLAY_MS)
}

const subscribeReplay = (l: () => void) => {
  replayListeners.add(l)
  return () => {
    replayListeners.delete(l)
  }
}

export function useReplay() {
  const s = useSyncExternalStore(subscribeReplay, () => snap, () => snap)
  useEffect(() => {
    if (API_MODE === 'mock') void loadStory()
  }, [])
  return {
    ...s,
    play: () => start('all'),
    nextBeat: () => start('beat'),
    pause: stop,
    reset: () => {
      story.index = 0
      stop()
    },
  }
}
