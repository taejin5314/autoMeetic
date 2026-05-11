/**
 * Caption overlay — shows live transcript captions over the whiteboard.
 * Ported from autopreso/public/app.js caption/waveform patterns (MIT License).
 */
import type { CaptionItem } from './types'

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
}

export function CaptionOverlay({ items, currentPartial }: CaptionOverlayProps) {
  const latestCommitted = items[items.length - 1]
  const displayText = currentPartial || latestCommitted?.sourceText || ''

  return (
    <>
      {/* Caption pill at bottom — shows latest text (autopreso pattern) */}
      <div className={`stage-overlay ${displayText ? 'visible' : ''}`} aria-hidden="true">
        {displayText ? (
          <div className="caption-pill" role="status" aria-live="polite">
            {truncateCaption(displayText)}
          </div>
        ) : null}
      </div>
    </>
  )
}
