import { useCallback, useEffect, useRef, useState } from 'react'
import type { SystemAudioCaptureService } from '../../main/audio/capture'
import type { SlackStatus } from '../../main/slack/types'
import { createSlackHuddleSessionGate } from './slackArmController'

export interface UseSlackArmOptions {
  enabled: boolean
  capture: SystemAudioCaptureService
  sessionActive: boolean
  beginSession(): Promise<void>
  endSession(): void
  onError(message: string): void
}

export interface SlackArmState {
  armed: boolean
  status: SlackStatus
  arm(): Promise<void>
  disarm(): Promise<void>
}

export function useSlackArm({
  enabled,
  capture,
  sessionActive,
  beginSession,
  endSession,
  onError,
}: UseSlackArmOptions): SlackArmState {
  const [armed, setArmed] = useState(false)
  const [status, setStatus] = useState<SlackStatus>({ state: 'not-connected' })
  const sessionActiveRef = useRef(sessionActive)
  const beginSessionRef = useRef(beginSession)
  const endSessionRef = useRef(endSession)

  useEffect(() => {
    sessionActiveRef.current = sessionActive
    beginSessionRef.current = beginSession
    endSessionRef.current = endSession
  }, [beginSession, endSession, sessionActive])

  const disarm = useCallback(async () => {
    capture.stop()
    if (enabled) {
      await window.electronAPI?.slack.disarm()
    }
    setArmed(false)
    setStatus({ state: 'not-connected' })
  }, [capture, enabled])

  const arm = useCallback(async () => {
    if (!enabled || armed) return
    try {
      await capture.start()
      await window.electronAPI?.slack.arm()
      setArmed(true)
      setStatus({ state: 'listening' })
    } catch (err) {
      capture.stop()
      const message = err instanceof Error ? err.message : String(err)
      setArmed(false)
      setStatus({ state: 'error', detail: message })
      onError(message)
    }
  }, [armed, capture, enabled, onError])

  useEffect(() => {
    if (!enabled) return undefined
    const api = window.electronAPI?.slack
    if (!api) return undefined
    const sessionGate = createSlackHuddleSessionGate({
      isSessionActive: () => sessionActiveRef.current,
      beginSession: () => beginSessionRef.current(),
      endSession: () => endSessionRef.current(),
    })

    const offStarted = api.onHuddleStarted(() => {
      void sessionGate.handleHuddleStarted()
    })
    const offEnded = api.onHuddleEnded(() => {
      sessionGate.handleHuddleEnded()
    })
    const offStatus = api.onStatus((nextStatus) => {
      setStatus(nextStatus)
    })

    return () => {
      offStarted()
      offEnded()
      offStatus()
    }
  }, [enabled])

  useEffect(() => {
    const offEnded = capture.onEnded(() => {
      if (!armed) return
      setArmed(false)
      setStatus({ state: 'error', detail: 'Arm released. Re-arm to continue.' })
      if (enabled) {
        void window.electronAPI?.slack.disarm()
      }
    })
    return offEnded
  }, [armed, capture, enabled])

  return { armed, status, arm, disarm }
}
