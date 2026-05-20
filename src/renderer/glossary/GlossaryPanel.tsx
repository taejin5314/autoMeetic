import { useMemo, useState } from 'react'
import { GlossaryRowEditor } from './GlossaryRowEditor'
import type { GlossaryEntry, GlossaryEntryInput } from './types'
import { useGlossaryStore } from './useGlossaryStore'

interface Props {
  open: boolean
  meetingId: string | null
  onClose: () => void
}

type Tab = 'global' | 'meeting'

export function GlossaryPanel({ open, meetingId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('global')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const scope: 'global' | 'meeting' = tab
  const store = useGlossaryStore(scope, meetingId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return store.entries
    return store.entries.filter((entry) => {
      if (entry.sourceTerm.toLowerCase().includes(q)) return true
      return Object.values(entry.translations).some((value) => value.toLowerCase().includes(q))
    })
  }, [store.entries, query])

  if (!open) return null

  const handleSave = async (input: GlossaryEntryInput) => {
    await store.upsert(input)
    setEditingId(null)
    setCreating(false)
  }

  const renderRow = (entry: GlossaryEntry) => {
    if (editingId === entry.id) {
      return (
        <GlossaryRowEditor
          key={entry.id}
          initial={entry}
          scope={scope}
          meetingId={meetingId}
          onSave={handleSave}
          onCancel={() => setEditingId(null)}
        />
      )
    }

    const translations = Object.entries(entry.translations)
    return (
      <div className="glossary-row" key={entry.id}>
        <div className="glossary-row-term amw-mono">{entry.sourceTerm}</div>
        <div className="glossary-row-translations">
          {translations.length === 0 ? (
            <span className="glossary-row-empty">-</span>
          ) : (
            translations.map(([lang, value]) => (
              <span key={lang} className="glossary-translation-pill">
                <em className="amw-mono">{lang}</em>: {value}
              </span>
            ))
          )}
        </div>
        <div className="glossary-row-preserve">
          {entry.preserve && <span className="glossary-preserve-chip">Preserve</span>}
        </div>
        <div className="glossary-row-actions">
          <button type="button" onClick={() => setEditingId(entry.id)}>
            Edit
          </button>
          <button
            type="button"
            className="glossary-row-delete"
            onClick={() => {
              if (window.confirm(`Delete "${entry.sourceTerm}"?`)) void store.remove(entry.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="glossary-overlay" role="dialog" aria-label="Glossary">
      <div className="glossary-panel">
        <header className="glossary-head">
          <div className="glossary-head-title">
            <h2>Glossary</h2>
            <span className="amw-mono glossary-head-count">
              {filtered.length} of {store.entries.length}
            </span>
          </div>
          <button
            type="button"
            className="glossary-close"
            onClick={onClose}
            aria-label="Close glossary"
          >
            ×
          </button>
        </header>

        <div className="glossary-tabs">
          <button
            type="button"
            className={`glossary-tab ${tab === 'global' ? 'on' : ''}`}
            onClick={() => setTab('global')}
          >
            Global
          </button>
          <button
            type="button"
            className={`glossary-tab ${tab === 'meeting' ? 'on' : ''}`}
            onClick={() => setTab('meeting')}
            disabled={!meetingId}
            title={meetingId ? 'This meeting' : 'No live meeting'}
          >
            This meeting
          </button>
        </div>

        <div className="glossary-toolbar">
          <input
            type="text"
            placeholder="Search source or translation"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="glossary-search"
          />
          <button
            type="button"
            className="glossary-add"
            onClick={() => setCreating(true)}
            disabled={creating || editingId !== null}
          >
            + Add term
          </button>
        </div>

        {store.errorMessage && <div className="glossary-error-banner">{store.errorMessage}</div>}

        <div className="glossary-list amw-scroll">
          {creating && (
            <GlossaryRowEditor
              scope={scope}
              meetingId={meetingId}
              onSave={handleSave}
              onCancel={() => setCreating(false)}
            />
          )}
          {filtered.length === 0 && !creating && (
            <div className="glossary-empty">
              <p>{store.status === 'loading' ? 'Loading terms...' : 'No glossary entries'}</p>
            </div>
          )}
          {filtered.map(renderRow)}
        </div>

        <footer className="glossary-foot">
          <span className="amw-mono">{store.entries.length} entries</span>
          <span className="glossary-foot-hint">
            {tab === 'global' ? 'Global' : 'Meeting'} scope
          </span>
        </footer>
      </div>
    </div>
  )
}
