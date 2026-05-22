import { useEffect, useRef, useState, type RefObject } from 'react'

type UseTranscriptScrollSyncArgs = {
  items: readonly unknown[]
  currentPartial: string
  syncKey: unknown
}

type UseTranscriptScrollSyncResult = {
  enColRef: RefObject<HTMLDivElement | null>
  koColRef: RefObject<HTMLDivElement | null>
}

export function useTranscriptScrollSync({
  items,
  currentPartial,
  syncKey,
}: UseTranscriptScrollSyncArgs): UseTranscriptScrollSyncResult {
  const enColRef = useRef<HTMLDivElement>(null)
  const koColRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef(false)
  const programmaticScrollUntilRef = useRef(0)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (!autoScroll) return
    const en = enColRef.current
    const ko = koColRef.current
    requestAnimationFrame(() => {
      programmaticScrollUntilRef.current = performance.now() + 250
      syncingScrollRef.current = true
      if (en) en.scrollTop = en.scrollHeight
      if (ko) ko.scrollTop = ko.scrollHeight
      requestAnimationFrame(() => {
        syncingScrollRef.current = false
      })
    })
  }, [items, currentPartial, autoScroll])

  useEffect(() => {
    const en = enColRef.current
    const ko = koColRef.current
    if (!en) return

    const updateAutoScroll = (el: HTMLDivElement) => {
      if (syncingScrollRef.current || performance.now() < programmaticScrollUntilRef.current) {
        return
      }
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(isNearBottom)
    }

    const link = (from: HTMLDivElement, to: HTMLDivElement | null) => () => {
      updateAutoScroll(from)
      if (!to || syncingScrollRef.current) return
      syncingScrollRef.current = true
      const denom = from.scrollHeight - from.clientHeight || 1
      const ratio = from.scrollTop / denom
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
      programmaticScrollUntilRef.current = performance.now() + 120
      requestAnimationFrame(() => {
        syncingScrollRef.current = false
      })
    }

    const onEn = link(en, ko)
    en.addEventListener('scroll', onEn, { passive: true })
    let onKo: (() => void) | null = null
    if (ko) {
      onKo = link(ko, en)
      ko.addEventListener('scroll', onKo, { passive: true })
    }
    return () => {
      en.removeEventListener('scroll', onEn)
      if (ko && onKo) ko.removeEventListener('scroll', onKo)
    }
  }, [syncKey])

  return { enColRef, koColRef }
}
