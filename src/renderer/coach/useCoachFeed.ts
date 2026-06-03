import { useCallback, useEffect, useState } from 'react'
import type { CoachEvent } from './types'

const MAX_COACH_CARDS = 30

export type CoachCard = CoachEvent & {
  id: string
  dismissed: boolean
}

function makeCoachCardId(event: CoachEvent): string {
  if (event.type === 'past-context') {
    return `${event.type}:${event.clusterId}:${event.turnId}:${event.emittedAtMs}`
  }
  return `${event.type}:${event.canonical}:${event.variant}:${event.turnId}:${event.emittedAtMs}`
}

export function useCoachFeed(): {
  cards: CoachCard[]
  dismiss: (id: string) => void
  clearAll: () => void
} {
  const [cards, setCards] = useState<CoachCard[]>([])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.coach?.onEvent((event) => {
      const card: CoachCard = {
        ...event,
        id: makeCoachCardId(event),
        dismissed: false,
      }
      setCards((current) => [card, ...current].slice(0, MAX_COACH_CARDS))
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, dismissed: true } : card))
    )
  }, [])

  const clearAll = useCallback(() => {
    setCards((current) => current.map((card) => ({ ...card, dismissed: true })))
  }, [])

  return { cards, dismiss, clearAll }
}

