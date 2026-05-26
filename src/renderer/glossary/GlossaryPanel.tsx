import { useCallback, useMemo, useState } from 'react'
import { GlossaryRowEditor } from './GlossaryRowEditor'
import { GlossarySaveSuccessCard } from './GlossarySaveSuccessCard'
import { SuggestionRow } from './SuggestionRow'
import type { GlossaryEntry, GlossaryEntryInput, VariantCandidate } from './types'
import { useGlossaryStore } from './useGlossaryStore'

interface Props {
  open: boolean
  meetingId: string | null
  onClose: () => void
}

type Tab = 'suggestions' | 'global' | 'meeting'

export function GlossaryPanel({ open, meetingId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('global')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [lastVariantCandidates, setLastVariantCandidates] = useState<VariantCandidate[]>([])
  const [saveCard, setSaveCard] = useState<{
    entry: GlossaryEntry
    candidates: VariantCandidate[]
  } | null>(null)

  const scope: 'global' | 'meeting' = tab === 'meeting' ? 'meeting' : 'global'
  const store = useGlossaryStore(scope, meetingId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return store.entries
    return store.entries.filter((entry) => {
      if (entry.sourceTerm.toLowerCase().includes(q)) return true
      return Object.values(entry.translations).some((value) => value.toLowerCase().includes(q))
    })
  }, [store.entries, query])

  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return store.suggestions
    return store.suggestions.filter((suggestion) => {
      if (suggestion.sourceTerm.toLowerCase().includes(q)) return true
      return Object.values(suggestion.translations).some((value) => value.toLowerCase().includes(q))
    })
  }, [store.suggestions, query])

  const eligibleSuggestions = useMemo(
    () => store.suggestions.filter((suggestion) => suggestion.confidence >= 0.7),
    [store.suggestions]
  )

  const dismissSaveCard = useCallback(() => setSaveCard(null), [])

  if (!open) return null

  const handleSave = async (input: GlossaryEntryInput) => {
    const entry = await store.upsert(input)
    if (entry) {
      setSaveCard({ entry, candidates: lastVariantCandidates })
    }
    setLastVariantCandidates([])
    setEditingId(null)
    setCreating(false)
  }

  const handleBulkAccept = async () => {
    await store.bulkAcceptSuggestions(eligibleSuggestions.map((suggestion) => suggestion.id))
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
          onVariantCandidatesChange={setLastVariantCandidates}
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
        {entry.variants.length > 0 && (
          <div className="glossary-row-variants">
            {entry.variants.map((v) => (
              <span key={v} className="glossary-row-variant-chip">
                {v}
              </span>
            ))}
          </div>
        )}
        <div className="glossary-row-preserve">
          {entry.preserve && <span className="glossary-preserve-chip">Preserve</span>}
        </div>
        <div className="glossary-row-actions">
          <button
            type="button"
            onClick={() => {
              setLastVariantCandidates([])
              setEditingId(entry.id)
            }}
          >
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
              {tab === 'suggestions'
                ? `${filteredSuggestions.length} of ${store.pendingCount}`
                : `${filtered.length} of ${store.entries.length}`}
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
            className={`glossary-tab ${tab === 'suggestions' ? 'on' : ''}`}
            onClick={() => {
              setTab('suggestions')
              setCreating(false)
              setEditingId(null)
            }}
          >
            Suggestions{store.pendingCount > 0 ? ` (${store.pendingCount})` : ''}
          </button>
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
            onClick={() => {
              setLastVariantCandidates([])
              setCreating(true)
            }}
            disabled={tab === 'suggestions' || creating || editingId !== null}
          >
            + Add term
          </button>
          {tab === 'suggestions' && eligibleSuggestions.length > 0 && (
            <button type="button" className="glossary-bulk-accept" onClick={handleBulkAccept}>
              Accept all ({eligibleSuggestions.length})
            </button>
          )}
        </div>

        {store.errorMessage && <div className="glossary-error-banner">{store.errorMessage}</div>}

        <div className="glossary-list amw-scroll">
          {tab === 'suggestions' ? (
            <>
              {filteredSuggestions.length === 0 ? (
                <div className="glossary-empty">
                  <p>
                    {store.pendingCount === 0
                      ? 'No pending suggestions - autoMeetic suggests new terms after each meeting ends.'
                      : 'No suggestions match your search.'}
                  </p>
                </div>
              ) : (
                filteredSuggestions.map((suggestion) => (
                  <SuggestionRow
                    key={suggestion.id}
                    suggestion={suggestion}
                    onAccept={store.acceptSuggestion}
                    onDismiss={store.dismissSuggestion}
                  />
                ))
              )}
            </>
          ) : (
            <>
              {creating && (
                <GlossaryRowEditor
                  scope={scope}
                  meetingId={meetingId}
                  onSave={handleSave}
                  onCancel={() => setCreating(false)}
                  onVariantCandidatesChange={setLastVariantCandidates}
                />
              )}
              {filtered.length === 0 && !creating && (
                <div className="glossary-empty">
                  <p>{store.status === 'loading' ? 'Loading terms...' : 'No glossary entries'}</p>
                </div>
              )}
              {filtered.map(renderRow)}
            </>
          )}
        </div>

        <footer className="glossary-foot">
          <span className="amw-mono">
            {tab === 'suggestions' ? `${store.pendingCount} suggestions` : `${store.entries.length} entries`}
          </span>
          <span className="glossary-foot-hint">
            {tab === 'suggestions' ? 'Review queue' : `${tab === 'global' ? 'Global' : 'Meeting'} scope`}
          </span>
        </footer>
        {saveCard && (
          <GlossarySaveSuccessCard
            entry={saveCard.entry}
            candidates={saveCard.candidates}
            onDismiss={dismissSaveCard}
          />
        )}
      </div>
    </div>
  )
}
