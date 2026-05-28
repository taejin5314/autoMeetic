import { LogLevel, SocketModeClient } from '@slack/socket-mode'
import { classifyHuddleTransition } from './huddleTransition'
import type { HuddleTransition, SlackStatus, UserHuddleChangedEvent } from './types'

export interface HuddleTransport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  onEvent(handler: (event: UserHuddleChangedEvent) => void): void
  onStatus(handler: (status: SlackStatus) => void): void
}

export interface HuddleDetector {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface HuddleDetectorOptions {
  transport: HuddleTransport
  memberId: string
  onTransition(transition: HuddleTransition): void
  onStatus(status: SlackStatus): void
}

interface SocketModeEnvelope {
  event?: unknown
  ack?: () => Promise<void>
}

export function createHuddleDetector({
  transport,
  memberId,
  onTransition,
  onStatus,
}: HuddleDetectorOptions): HuddleDetector {
  let prevInHuddle = false

  transport.onEvent((event) => {
    const transition = classifyHuddleTransition(prevInHuddle, event, memberId)
    prevInHuddle = transition.nextInHuddle
    if (transition.kind !== 'none') {
      onTransition(transition)
    }
  })
  transport.onStatus(onStatus)

  return {
    start: () => transport.connect(),
    stop: () => transport.disconnect(),
  }
}

export function createSocketModeHuddleTransport(appToken: string): HuddleTransport {
  const client = new SocketModeClient({ appToken, logLevel: LogLevel.ERROR })
  let eventHandler: ((event: UserHuddleChangedEvent) => void) | null = null
  let statusHandler: ((status: SlackStatus) => void) | null = null

  client.on('connecting', () => statusHandler?.({ state: 'reconnecting' }))
  client.on('connected', () => statusHandler?.({ state: 'connected' }))
  client.on('reconnecting', () => statusHandler?.({ state: 'reconnecting' }))
  client.on('disconnected', (error: unknown) => {
    statusHandler?.(error ? { state: 'error', detail: errorToMessage(error) } : { state: 'not-connected' })
  })
  client.on('error', (error: unknown) => statusHandler?.({ state: 'error', detail: errorToMessage(error) }))
  client.on('user_huddle_changed', async (payload: unknown) => {
    const envelope = isSocketModeEnvelope(payload) ? payload : null
    await envelope?.ack?.()
    if (isUserHuddleChangedEvent(envelope?.event)) {
      eventHandler?.(envelope.event)
    }
  })

  return {
    connect: async () => {
      await client.start()
    },
    disconnect: () => client.disconnect(),
    onEvent: (handler) => {
      eventHandler = handler
    },
    onStatus: (handler) => {
      statusHandler = handler
    },
  }
}

function isSocketModeEnvelope(value: unknown): value is SocketModeEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Record<string, unknown>
  return envelope.ack === undefined || typeof envelope.ack === 'function'
}

function isUserHuddleChangedEvent(value: unknown): value is UserHuddleChangedEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (event.type !== 'user_huddle_changed') return false
  const user = event.user
  if (!user || typeof user !== 'object') return false
  return typeof (user as Record<string, unknown>).id === 'string'
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
