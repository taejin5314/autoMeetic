import type { HuddleTransition, UserHuddleChangedEvent } from './types'

export function classifyHuddleTransition(
  prevInHuddle: boolean,
  event: UserHuddleChangedEvent,
  myMemberId: string
): HuddleTransition {
  if (event.user.id !== myMemberId) {
    return { kind: 'none', nextInHuddle: prevInHuddle }
  }

  const inHuddle = event.user.profile?.huddle_state === 'in_a_huddle'

  if (inHuddle && !prevInHuddle) {
    return { kind: 'started', callId: event.user.profile?.huddle_state_call_id, nextInHuddle: true }
  }

  if (!inHuddle && prevInHuddle) {
    return { kind: 'ended', nextInHuddle: false }
  }

  return { kind: 'none', nextInHuddle: inHuddle }
}
