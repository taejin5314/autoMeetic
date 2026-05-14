import { useCallback, useReducer } from 'react'
import type { ActionItem } from './types'

type ActionItemPatch = Partial<Pick<ActionItem, 'title' | 'owner' | 'due' | 'sourceText'>>

type State = {
  items: ActionItem[]
}

type Action =
  | { type: 'add-suggested'; items: ActionItem[] }
  | { type: 'accept'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'mark-done'; id: string }
  | { type: 'update'; id: string; patch: ActionItemPatch }
  | { type: 'reset' }

function reducer(state: State, action: Action): State {
  if (action.type === 'add-suggested') {
    const existing = new Set(state.items.map(normalizeKey))
    const fresh = action.items.filter((item) => {
      const key = normalizeKey(item)
      if (!key || existing.has(key)) return false
      existing.add(key)
      return true
    })
    return { items: [...fresh, ...state.items] }
  }

  if (action.type === 'accept') {
    return {
      items: state.items.map((item) =>
        item.id === action.id ? { ...item, status: 'accepted' } : item
      ),
    }
  }

  if (action.type === 'dismiss') {
    return {
      items: state.items.map((item) =>
        item.id === action.id ? { ...item, status: 'dismissed' } : item
      ),
    }
  }

  if (action.type === 'mark-done') {
    return {
      items: state.items.map((item) =>
        item.id === action.id ? { ...item, status: 'done' } : item
      ),
    }
  }

  if (action.type === 'update') {
    return {
      items: state.items.map((item) =>
        item.id === action.id ? normalizePatch({ ...item, ...action.patch }) : item
      ),
    }
  }

  if (action.type === 'reset') {
    return { items: [] }
  }

  return state
}

export function useActionItemsStore() {
  const [state, dispatch] = useReducer(reducer, { items: [] })

  const addSuggested = useCallback((items: ActionItem[]) => {
    dispatch({ type: 'add-suggested', items })
  }, [])

  const accept = useCallback((id: string) => {
    dispatch({ type: 'accept', id })
  }, [])

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'dismiss', id })
  }, [])

  const markDone = useCallback((id: string) => {
    dispatch({ type: 'mark-done', id })
  }, [])

  const updateItem = useCallback((id: string, patch: ActionItemPatch) => {
    dispatch({ type: 'update', id, patch })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'reset' })
  }, [])

  return {
    items: state.items,
    addSuggested,
    accept,
    dismiss,
    markDone,
    updateItem,
    reset,
  }
}

function normalizePatch(item: ActionItem): ActionItem {
  return {
    ...item,
    title: item.title.trim(),
    owner: item.owner?.trim() || undefined,
    due: item.due?.trim() || undefined,
    sourceText: item.sourceText.trim(),
  }
}

function normalizeKey(item: ActionItem): string {
  return [item.title, item.owner ?? '', item.due ?? '']
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
