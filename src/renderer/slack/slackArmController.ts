export interface SlackHuddleSessionGateOptions {
  isSessionActive(): boolean
  beginSession(): Promise<void>
  endSession(): void
}

export interface SlackHuddleSessionGate {
  handleHuddleStarted(): Promise<void>
  handleHuddleEnded(): void
}

export function createSlackHuddleSessionGate({
  isSessionActive,
  beginSession,
  endSession,
}: SlackHuddleSessionGateOptions): SlackHuddleSessionGate {
  let beginPending = false
  let endedWhilePending = false

  return {
    async handleHuddleStarted() {
      if (beginPending || isSessionActive()) return
      beginPending = true
      endedWhilePending = false
      try {
        await beginSession()
      } finally {
        beginPending = false
      }
      if (endedWhilePending && isSessionActive()) {
        endedWhilePending = false
        endSession()
      }
    },

    handleHuddleEnded() {
      if (beginPending) {
        endedWhilePending = true
        return
      }
      if (isSessionActive()) {
        endSession()
      }
    },
  }
}
