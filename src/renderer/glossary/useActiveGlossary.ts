import { useEffect, useState } from 'react'
import type { GlossaryEntry } from './types'

export function useActiveGlossary(meetingId: string | null): GlossaryEntry[] {
  const [entries, setEntries] = useState<GlossaryEntry[]>([])

  useEffect(() => {
    let active = true
    const load = async () => {
      const api = window.electronAPI?.glossary
      if (!api) {
        if (active) setEntries([])
        return
      }
      const list = await api.active(meetingId ?? undefined)
      if (active) setEntries(list)
    }
    void load()
    const off =
      window.electronAPI?.glossary?.onEntriesUpdated?.(() => {
        void load()
      }) ?? (() => {})
    return () => {
      active = false
      off()
    }
  }, [meetingId])

  return entries
}
