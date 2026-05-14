/**
 * Caption overlay — shows live transcript captions over the whiteboard.
 * Styled to match autopreso's caption pill (MIT License).
 */

const CAPTION_MAX_CHARS = 70

function truncateCaption(text: string): string {
  if (!text || text.length <= CAPTION_MAX_CHARS) return text
  const tail = text.slice(-CAPTION_MAX_CHARS)
  const space = tail.indexOf(' ')
  return space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail
}

interface CaptionOverlayProps {
  currentPartial: string
}

export function CaptionOverlay({ currentPartial }: CaptionOverlayProps) {
  const displayText = truncateCaption(currentPartial)

  return (
    <div className={`stage-overlay ${displayText ? 'visible' : ''}`} aria-hidden="true">
      {displayText ? (
        <div className="caption-pill" role="status" aria-live="polite">
          {displayText}
        </div>
      ) : null}
    </div>
  )
}
