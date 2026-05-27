import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { HighlightedText } from '../glossary/HighlightedText'
import { useActiveGlossary } from '../glossary/useActiveGlossary'
import { useHighlightToggle } from '../glossary/useHighlightToggle'
import type { CaptionItem } from '../overlay/types'

type TranscriptColumnItem = Pick<
  CaptionItem,
  | 'id'
  | 'createdAtMs'
  | 'fullSource'
  | 'displayedSource'
  | 'fullTranslation'
  | 'displayedTranslation'
  | 'typing'
>

type TranscriptColumnsProps = {
  items: TranscriptColumnItem[]
  hasFeedContent: boolean
  showTranslationColumn: boolean
  sourceLang: string
  targetLang: string
  languageLock: string | null
  detectedLanguage: string | null
  sessionStartMs: number | null
  enColRef: RefObject<HTMLDivElement | null>
  koColRef: RefObject<HTMLDivElement | null>
  langCode: (code: string) => string
  formatDuration: (ms: number) => string
  languageLabelByCode: ReadonlyMap<string, string>
}

export function TranscriptColumns({
  items,
  hasFeedContent,
  showTranslationColumn,
  sourceLang,
  targetLang,
  languageLock,
  detectedLanguage,
  sessionStartMs,
  enColRef,
  koColRef,
  langCode,
  formatDuration,
  languageLabelByCode,
}: TranscriptColumnsProps) {
  const { t } = useTranslation()
  const entries = useActiveGlossary(null)
  const [highlightEnabled] = useHighlightToggle()

  return (
    <section className="v4p-cols">
      <div className="v4p-col">
        <div className="v4p-col-hd">
          <span className="v4p-col-mark">{langCode(sourceLang)}</span>
          <span className="v4p-col-name">
            <em>{t('transcript.original')}</em>
            {languageLock && <> · {languageLabelByCode.get(languageLock) ?? languageLock}</>}
            {!languageLock && detectedLanguage && (
              <>
                {' '}
                · {t('transcript.detecting', {
                  language: languageLabelByCode.get(detectedLanguage) ?? detectedLanguage,
                })}
              </>
            )}
          </span>
        </div>
        <div className="v4p-col-body amw-scroll" ref={enColRef}>
          <div className="v4p-col-pad">
            {!hasFeedContent && (
              <p className="v4p-empty">
                <em>{t('transcript.idleLead')}</em> {t('transcript.idleInstruction')}{' '}
                <kbd>{t('shell.record.start')}</kbd> {t('transcript.idleInstructionAfterStart')}
              </p>
            )}
            {items.map((item) => (
              <div className="v4p-line" key={`en-${item.id}`}>
                <div className="v4p-line-time amw-mono">
                  {formatDuration(
                    Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
                  )}
                </div>
                <div
                  className={`v4p-line-text${
                    item.typing && item.displayedSource.length < item.fullSource.length
                      ? ' v4p-line-typing'
                      : ''
                  }`}
                >
                  <HighlightedText
                    text={item.displayedSource}
                    entries={entries}
                    enabled={highlightEnabled}
                  />
                </div>
              </div>
            ))}
            <div className="v4p-trail">· · ·</div>
          </div>
        </div>
      </div>

      {showTranslationColumn && (
        <div className="v4p-col v4p-col-trans">
          <div className="v4p-col-hd">
            <span className="v4p-col-mark v4p-col-mark-alt">{langCode(targetLang)}</span>
            <span className="v4p-col-name">
              <em>{t('transcript.translation')}</em> ·{' '}
              {languageLabelByCode.get(targetLang) ?? targetLang}
            </span>
          </div>
          <div className="v4p-col-body amw-scroll" ref={koColRef}>
            <div className="v4p-col-pad">
              {items.length === 0 && (
                <p className="v4p-empty">
                  <em>{t('transcript.translationEmpty')}</em>
                </p>
              )}
              {items.map((item) => {
                if (item.fullTranslation === null) return null
                return (
                  <div className="v4p-line" key={`tr-${item.id}`}>
                    <div className="v4p-line-time amw-mono">
                      {formatDuration(
                        Math.max(item.createdAtMs - (sessionStartMs ?? item.createdAtMs), 0)
                      )}
                    </div>
                    <div
                      className={`v4p-line-text${
                        item.typing &&
                        item.displayedTranslation.length < item.fullTranslation.length
                          ? ' v4p-line-typing'
                          : ''
                      }`}
                    >
                      <HighlightedText
                        text={item.displayedTranslation}
                        entries={entries}
                        enabled={highlightEnabled}
                      />
                    </div>
                  </div>
                )
              })}
              <div className="v4p-trail">· · ·</div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
