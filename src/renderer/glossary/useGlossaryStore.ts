import { useCallback, useEffect, useState } from 'react'
import type { GlossaryEntry, GlossaryEntryInput, GlossarySuggestion } from './types'

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
  const [suggestions, setSuggestions] = useState<GlossarySuggestion[]>([])
  const [pendingCount, setPendingCount] = useState<number>(0)

  const load = useCallback(async () => {
    await Promise.resolve()
    const api = window.electronAPI?.glossary
    if (!api) {
      setState({ entries: [], status: 'idle', errorMessage: null })
      return
    }
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const entries = await api.list(
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

  const loadSuggestions = useCallback(async () => {
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) {
      setSuggestions([])
      setPendingCount(0)
      return
    }
    const [items, count] = await Promise.all([api.list(), api.count()])
    setSuggestions(items)
    setPendingCount(count)
  }, [])

  const acceptSuggestion = useCallback(async (id: string) => {
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) return
    await api.accept(id)
  }, [])

  const dismissSuggestion = useCallback(async (id: string) => {
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) return
    await api.dismiss(id)
  }, [])

  const bulkAcceptSuggestions = useCallback(async (ids: string[]) => {
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) return { accepted: 0, failed: 0 }
    const result = await api.bulkAccept(ids)
    return { accepted: result.accepted.length, failed: result.failed.length }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useEffect(() => {
    const api = window.electronAPI?.glossary
    if (!api) return
    return api.onChanged(() => {
      void load()
    })
  }, [load])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSuggestions()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadSuggestions])

  useEffect(() => {
    const api = window.electronAPI?.glossary
    if (!api?.suggestions) return
    return api.suggestions.onUpdated(() => {
      void loadSuggestions()
    })
  }, [loadSuggestions])

  return {
    entries: state.entries,
    status: state.status,
    errorMessage: state.errorMessage,
    refresh: load,
    upsert,
    remove,
    suggestions,
    pendingCount,
    loadSuggestions,
    acceptSuggestion,
    dismissSuggestion,
    bulkAcceptSuggestions,
  }
}
