import { describe, expect, it } from 'vitest'
import { createSlackHuddleSessionGate } from '../renderer/slack/slackArmController'

describe('createSlackHuddleSessionGate', () => {
  it('ends a session that finishes starting after huddle-ended already arrived', async () => {
    let active = false
    let resolveBegin: (() => void) | null = null
    let endCount = 0
    const gate = createSlackHuddleSessionGate({
      isSessionActive: () => active,
      beginSession: () =>
        new Promise<void>((resolve) => {
          resolveBegin = () => {
            active = true
            resolve()
          }
        }),
      endSession: () => {
        active = false
        endCount += 1
      },
    })

    const started = gate.handleHuddleStarted()
    gate.handleHuddleEnded()
    resolveBegin?.()
    await started

    expect(endCount).toBe(1)
    expect(active).toBe(false)
  })

  it('does not begin a duplicate session while one is pending or active', async () => {
    let active = false
    let beginCount = 0
    const gate = createSlackHuddleSessionGate({
      isSessionActive: () => active,
      beginSession: async () => {
        beginCount += 1
        active = true
      },
      endSession: () => {
        active = false
      },
    })

    await Promise.all([gate.handleHuddleStarted(), gate.handleHuddleStarted()])
    await gate.handleHuddleStarted()

    expect(beginCount).toBe(1)
  })

  it('ends an active session when huddle-ended arrives', () => {
    let active = true
    let endCount = 0
    const gate = createSlackHuddleSessionGate({
      isSessionActive: () => active,
      beginSession: async () => {
        active = true
      },
      endSession: () => {
        active = false
        endCount += 1
      },
    })

    gate.handleHuddleEnded()

    expect(endCount).toBe(1)
    expect(active).toBe(false)
  })
})
