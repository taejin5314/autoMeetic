import { describe, expect, it } from 'vitest'
import { createHuddleDetector, type HuddleTransport } from '../main/slack/slackHuddleDetector'
import type { HuddleTransition, SlackStatus, UserHuddleChangedEvent } from '../main/slack/types'

const ME = 'U_ME'

function ev(id: string, huddle_state?: string, callId?: string): UserHuddleChangedEvent {
  return {
    type: 'user_huddle_changed',
    user: { id, profile: { huddle_state, huddle_state_call_id: callId } },
  }
}

class FakeTransport implements HuddleTransport {
  connected = false
  disconnected = false
  private eventHandler: ((event: UserHuddleChangedEvent) => void) | null = null
  private statusHandler: ((status: SlackStatus) => void) | null = null

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.disconnected = true
  }

  onEvent(handler: (event: UserHuddleChangedEvent) => void): void {
    this.eventHandler = handler
  }

  onStatus(handler: (status: SlackStatus) => void): void {
    this.statusHandler = handler
  }

  emitEvent(event: UserHuddleChangedEvent): void {
    this.eventHandler?.(event)
  }

  emitStatus(status: SlackStatus): void {
    this.statusHandler?.(status)
  }
}

describe('createHuddleDetector', () => {
  it('starts and stops the injected transport', async () => {
    const transport = new FakeTransport()
    const detector = createHuddleDetector({
      transport,
      memberId: ME,
      onTransition: () => {},
      onStatus: () => {},
    })

    await detector.start()
    await detector.stop()

    expect(transport.connected).toBe(true)
    expect(transport.disconnected).toBe(true)
  })

  it('dispatches started and ended transitions for my huddle events', async () => {
    const transport = new FakeTransport()
    const transitions: HuddleTransition[] = []
    const detector = createHuddleDetector({
      transport,
      memberId: ME,
      onTransition: (transition) => transitions.push(transition),
      onStatus: () => {},
    })
    await detector.start()

    transport.emitEvent(ev(ME, 'in_a_huddle', 'C1'))
    transport.emitEvent(ev(ME, '', 'C1'))

    expect(transitions.map((transition) => transition.kind)).toEqual(['started', 'ended'])
    expect(transitions[0]?.callId).toBe('C1')
  })

  it('tracks prevInHuddle and ignores repeats and other users', async () => {
    const transport = new FakeTransport()
    const transitions: HuddleTransition[] = []
    const detector = createHuddleDetector({
      transport,
      memberId: ME,
      onTransition: (transition) => transitions.push(transition),
      onStatus: () => {},
    })
    await detector.start()

    transport.emitEvent(ev('U_OTHER', 'in_a_huddle', 'C_OTHER'))
    transport.emitEvent(ev(ME, 'in_a_huddle', 'C1'))
    transport.emitEvent(ev(ME, 'in_a_huddle', 'C1'))
    transport.emitEvent(ev(ME, ''))
    transport.emitEvent(ev(ME, ''))

    expect(transitions.map((transition) => transition.kind)).toEqual(['started', 'ended'])
  })

  it('forwards transport status updates', async () => {
    const transport = new FakeTransport()
    const statuses: SlackStatus[] = []
    const detector = createHuddleDetector({
      transport,
      memberId: ME,
      onTransition: () => {},
      onStatus: (status) => statuses.push(status),
    })
    await detector.start()

    transport.emitStatus({ state: 'connected' })
    transport.emitStatus({ state: 'reconnecting', detail: 'socket disconnected' })

    expect(statuses).toEqual([{ state: 'connected' }, { state: 'reconnecting', detail: 'socket disconnected' }])
  })
})
