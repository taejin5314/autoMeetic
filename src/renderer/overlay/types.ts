export interface CaptionItem {
  id: string
  /** Full source text, set when the processed turn arrives. */
  fullSource: string
  /** Full translation text, or null when not translated. */
  fullTranslation: string | null
  /** Characters currently revealed by the typewriter (<= fullSource.length). */
  displayedSource: string
  /** Characters currently revealed for translation (<= fullTranslation.length). */
  displayedTranslation: string
  /** True while typewriter is still advancing this item. */
  typing: boolean
  createdAtMs: number
  updatedAtMs: number
  speakerId?: string
  speakerLabel?: string
  /** ISO source-language code from the processed turn, used by the typewriter to pick speed. */
  sourceLanguage?: string
  /** Legacy alias for fullSource so existing consumers (Answer Assist transcript window) keep working. */
  sourceText: string
  /** Legacy alias for displayed translation. */
  translatedText?: string
}
