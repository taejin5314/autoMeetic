import type { RefObject } from 'react'
import type { CaptionItem } from '../overlay/types'

export type TranscriptColumnItem = Pick<
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
  languageLabelByCode: Map<string, string>
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
  return (
    <section className="v4p-cols">
      <div className="v4p-col">
        <div className="v4p-col-hd">
          <span className="v4p-col-mark">{langCode(sourceLang)}</span>
          <span className="v4p-col-name">
            <em>Original</em>
            {languageLock && <> · {languageLabelByCode.get(languageLock) ?? languageLock}</>}
            {!languageLock && detectedLanguage && (
              <>
                {' '}
                · detecting {languageLabelByCode.get(detectedLanguage) ?? detectedLanguage}
              </>
            )}
          </span>
        </div>
        <div className="v4p-col-body amw-scroll" ref={enColRef}>
          <div className="v4p-col-pad">
            {!hasFeedContent && (
              <p className="v4p-empty">
                <em>Idle.</em> Press <kbd>Start</kbd> and share a tab with audio to begin.
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
                  {item.displayedSource}
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
              <em>Translation</em> · {languageLabelByCode.get(targetLang) ?? targetLang}
            </span>
          </div>
          <div className="v4p-col-body amw-scroll" ref={koColRef}>
            <div className="v4p-col-pad">
              {items.length === 0 && (
                <p className="v4p-empty">
                  <em>Translations appear here.</em>
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
                      {item.displayedTranslation}
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
