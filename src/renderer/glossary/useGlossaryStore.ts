import { useCallback, useEffect, useState } from 'react'
import type { GlossaryEntry, GlossaryEntryInput } from './types'

interface GlossaryState {
  entries: GlossaryEntry[]
  status: 'idle' | 'loading' | 'error'
  errorMessage: string | null
}

export function useGlossaryStore(scope: 'global' | 'meeting', meetingId: string | null) {
  const [state, setState] = useState<GlossaryState>({
    entries: [],
    status: 'idle',
    errorMessage: null,
  })

  const load = useCallback(async () => {
    if (!window.electronAPI?.glossary) {
      setState({ entries: [], status: 'idle', errorMessage: null })
      return
    }
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const entries = await window.electronAPI.glossary.list(
        scope,
        scope === 'meeting' ? meetingId ?? undefined : undefined
      )
      setState({ entries, status: 'idle', errorMessage: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, status: 'error', errorMessage: msg }))
    }
  }, [scope, meetingId])

  const upsert = useCallback(async (input: GlossaryEntryInput) => {
    if (!window.electronAPI?.glossary) return
    await window.electronAPI.glossary.upsert(input)
  }, [])

  const remove = useCallback(async (id: string) => {
    if (!window.electronAPI?.glossary) return
    await window.electronAPI.glossary.delete(id)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const api = window.electronAPI?.glossary
    if (!api) return
    return api.onChanged(() => {
      void load()
    })
  }, [load])

  return {
    entries: state.entries,
    status: state.status,
    errorMessage: state.errorMessage,
    refresh: load,
    upsert,
    remove,
  }
}
