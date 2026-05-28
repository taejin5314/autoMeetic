export interface SlackTokens {
  appToken: string
  botToken: string
  memberId: string
}

export type SlackConnectionState =
  | 'not-connected'
  | 'connected'
  | 'listening'
  | 'transcribing'
  | 'reconnecting'
  | 'error'

export interface SlackStatus {
  state: SlackConnectionState
  detail?: string
}

export interface UserHuddleChangedEvent {
  type: 'user_huddle_changed'
  user: {
    id: string
    profile?: {
      huddle_state?: string
      huddle_state_call_id?: string
    }
  }
}

export interface HuddleTransition {
  kind: 'started' | 'ended' | 'none'
  callId?: string
  nextInHuddle: boolean
}
