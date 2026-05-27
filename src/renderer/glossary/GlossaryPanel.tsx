import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GlossaryRowEditor } from './GlossaryRowEditor'
import { GlossarySaveSuccessCard } from './GlossarySaveSuccessCard'
import { SuggestionRow } from './SuggestionRow'
import type { GlossaryEntry, GlossaryEntryInput, VariantCandidate } from './types'
import { useHighlightToggle } from './useHighlightToggle'
import { useGlossaryStore } from './useGlossaryStore'

interface Props {
  open: boolean
  meetingId: string | null
  onClose: () => void
}

type Tab = 'suggestions' | 'global' | 'meeting'

export function GlossaryPanel({ open, meetingId, onClose }: Props) {
  const { t } = useTranslation()
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
  const [highlightEnabled, setHighlightEnabled] = useHighlightToggle()

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
          {entry.preserve && <span className="glossary-preserve-chip">{t('glossary.panel.preserve')}</span>}
        </div>
        <div className="glossary-row-actions">
          <button
            type="button"
            onClick={() => {
              setLastVariantCandidates([])
              setEditingId(entry.id)
            }}
          >
            {t('glossary.panel.edit')}
          </button>
          <button
            type="button"
            className="glossary-row-delete"
            onClick={() => {
              if (window.confirm(t('glossary.panel.deleteConfirm', { term: entry.sourceTerm }))) void store.remove(entry.id)
            }}
          >
            {t('glossary.panel.delete')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="glossary-overlay" role="dialog" aria-label={t('glossary.panel.dialogAria')}>
      <div className="glossary-panel">
        <header className="glossary-head">
          <div className="glossary-head-title">
            <h2>{t('glossary.panel.title')}</h2>
            <span className="amw-mono glossary-head-count">
              {tab === 'suggestions'
                ? `${filteredSuggestions.length} of ${store.pendingCount}`
                : `${filtered.length} of ${store.entries.length}`}
            </span>
          </div>
          <div className="glossary-head-actions">
            <label className="glossary-highlight-toggle">
              <input
                type="checkbox"
                checked={highlightEnabled}
                onChange={(e) => setHighlightEnabled(e.target.checked)}
              />
              {t('glossary.panel.showHighlights')}
            </label>
            <button
              type="button"
              className="glossary-close"
              onClick={onClose}
              aria-label={t('glossary.panel.closeAria')}
            >
            ×
            </button>
          </div>
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
            {t('glossary.panel.suggestionsTab')}
            {store.pendingCount > 0 ? ` (${store.pendingCount})` : ''}
          </button>
          <button
            type="button"
            className={`glossary-tab ${tab === 'global' ? 'on' : ''}`}
            onClick={() => setTab('global')}
          >
            {t('glossary.panel.globalTab')}
          </button>
          <button
            type="button"
            className={`glossary-tab ${tab === 'meeting' ? 'on' : ''}`}
            onClick={() => setTab('meeting')}
            disabled={!meetingId}
            title={meetingId ? t('glossary.panel.thisMeeting') : t('glossary.panel.noLiveMeeting')}
          >
            {t('glossary.panel.thisMeeting')}
          </button>
        </div>

        <div className="glossary-toolbar">
          <input
            type="text"
            placeholder={t('glossary.panel.searchPlaceholder')}
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
            {t('glossary.panel.addTerm')}
          </button>
          {tab === 'suggestions' && eligibleSuggestions.length > 0 && (
            <button type="button" className="glossary-bulk-accept" onClick={handleBulkAccept}>
              {t('glossary.panel.acceptAll', { count: eligibleSuggestions.length })}
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
                      ? t('glossary.panel.noPendingSuggestions')
                      : t('glossary.panel.noSuggestionMatches')}
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
                  <p>{store.status === 'loading' ? t('glossary.panel.loadingTerms') : t('glossary.panel.noEntries')}</p>
                </div>
              )}
              {filtered.map(renderRow)}
            </>
          )}
        </div>

        <footer className="glossary-foot">
          <span className="amw-mono">
            {tab === 'suggestions'
              ? t('glossary.panel.suggestionCount', { count: store.pendingCount })
              : t('glossary.panel.entryCount', { count: store.entries.length })}
          </span>
          <span className="glossary-foot-hint">
            {tab === 'suggestions'
              ? t('glossary.panel.reviewQueue')
              : t(tab === 'global' ? 'glossary.panel.globalScope' : 'glossary.panel.meetingScope')}
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
