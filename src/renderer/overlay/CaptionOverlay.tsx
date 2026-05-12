/**
 * Caption overlay — shows live transcript captions over the whiteboard.
 * Ported from autopreso/public/app.js caption/waveform patterns (MIT License).
 */

/**
 * Truncate caption to last ~70 chars, breaking at a word boundary.
 * Ported from autopreso/public/app.js truncateCaption()
 */
const CAPTION_MAX_CHARS = 70

function truncateCaption(text: string): string {
  if (!text || text.length <= CAPTION_MAX_CHARS) return text

  const tail = text.slice(-CAPTION_MAX_CHARS)
  const punctuation = tail.search(/[.!?。？！]\s+/)
  if (punctuation >= 0 && punctuation < tail.length - 2) {
    return `... ${tail.slice(punctuation + 1).trimStart()}`
  }

  const clause = tail.search(/[,;:，、]\s+/)
  if (clause >= 0 && clause < tail.length - 2) {
    return `... ${tail.slice(clause + 1).trimStart()}`
  }

  const space = tail.indexOf(' ')
  if (space >= 0 && space < tail.length - 1) {
    return `... ${tail.slice(space + 1)}`
  }

  return `... ${tail}`
}

interface CaptionOverlayProps {
  currentPartial: string
}

export function CaptionOverlay({ currentPartial }: CaptionOverlayProps) {
  const displayText = currentPartial

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
