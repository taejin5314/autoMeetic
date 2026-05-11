/**
 * Caption overlay — shows live transcript captions + waveform + feed.
 * Ported from autopreso/public/app.js caption/waveform patterns (MIT License).
 */
import type { CaptionItem } from './types'
import { Waveform } from './Waveform'

/**
 * Truncate caption to last ~70 chars, breaking at a word boundary.
 * Ported from autopreso/public/app.js truncateCaption()
 */
const CAPTION_MAX_CHARS = 70

function truncateCaption(text: string): string {
  if (!text || text.length <= CAPTION_MAX_CHARS) return text
  const tail = text.slice(-CAPTION_MAX_CHARS)
  const space = tail.indexOf(' ')
  return space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail
}

interface CaptionOverlayProps {
  items: CaptionItem[]
  currentPartial: string
  running: boolean
  analyser: AnalyserNode | null
}

export function CaptionOverlay({ items, currentPartial, running, analyser }: CaptionOverlayProps) {
  const latestCommitted = items[items.length - 1]
  const displayText = currentPartial || latestCommitted?.sourceText || ''

  return (
    <>
      {/* Waveform visualization area (autopreso pattern) */}
      <div className="waveform-area">
        <Waveform analyser={analyser} active={running} />
        {!running && items.length === 0 && (
          <div className="waveform-placeholder">
            <h2>Live Transcription</h2>
            <p>Share any tab or window audio to see real-time captions here.</p>
          </div>
        )}
      </div>

      {/* Caption pill at bottom — shows latest text (autopreso pattern) */}
      <div className={`stage-overlay ${(running && displayText) || displayText ? 'visible' : ''}`} aria-hidden="true">
        {displayText ? (
          <div className="caption-pill" role="status" aria-live="polite">
            {truncateCaption(displayText)}
          </div>
        ) : null}
      </div>

      {/* Live feed — committed transcripts (newest first) */}
      <section className="caption-feed" aria-label="caption feed">
        <header className="caption-feed-header">
          <strong>Live Feed</strong>
          <span className={`caption-badge ${running ? 'active' : ''}`}>{running ? 'LIVE' : 'IDLE'}</span>
        </header>

        <div className="caption-feed-list">
          {currentPartial ? (
            <article className="caption-item partial">
              <div className="caption-source">{currentPartial}</div>
            </article>
          ) : null}
          {[...items].reverse().map((item) => (
            <article key={item.id} className="caption-item">
              <div className="caption-source">{item.sourceText}</div>
              {item.translatedText ? <div className="caption-target">{item.translatedText}</div> : null}
            </article>
          ))}
          {items.length === 0 && !currentPartial && (
            <p className="caption-empty">No transcript yet.</p>
          )}
        </div>
      </section>
    </>
  )
}
