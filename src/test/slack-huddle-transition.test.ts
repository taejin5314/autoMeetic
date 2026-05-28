import { describe, expect, it } from 'vitest'
import { classifyHuddleTransition } from '../main/slack/huddleTransition'
import type { UserHuddleChangedEvent } from '../main/slack/types'

const ME = 'U_ME'

const ev = (id: string, huddle_state?: string, callId?: string): UserHuddleChangedEvent => ({
  type: 'user_huddle_changed',
  user: { id, profile: { huddle_state, huddle_state_call_id: callId } },
})

describe('classifyHuddleTransition', () => {
  it('started: my user enters in_a_huddle from not-in', () => {
    const r = classifyHuddleTransition(false, ev(ME, 'in_a_huddle', 'C1'), ME)
    expect(r.kind).toBe('started')
    expect(r.callId).toBe('C1')
    expect(r.nextInHuddle).toBe(true)
  })

  it('ended: my user leaves (huddle_state cleared)', () => {
    const r = classifyHuddleTransition(true, ev(ME, ''), ME)
    expect(r.kind).toBe('ended')
    expect(r.nextInHuddle).toBe(false)
  })

  it('none: event for a different user is ignored', () => {
    const r = classifyHuddleTransition(false, ev('U_OTHER', 'in_a_huddle'), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(false)
  })

  it('none: repeated in_a_huddle (no transition)', () => {
    const r = classifyHuddleTransition(true, ev(ME, 'in_a_huddle', 'C1'), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(true)
  })

  it('none: repeated not-in-huddle', () => {
    const r = classifyHuddleTransition(false, ev(ME, ''), ME)
    expect(r.kind).toBe('none')
    expect(r.nextInHuddle).toBe(false)
  })

  it('handles missing profile gracefully (treated as not in huddle)', () => {
    const r = classifyHuddleTransition(true, { type: 'user_huddle_changed', user: { id: ME } }, ME)
    expect(r.kind).toBe('ended')
    expect(r.nextInHuddle).toBe(false)
  })
})
