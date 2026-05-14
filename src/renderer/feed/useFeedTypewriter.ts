import { useEffect, useRef } from 'react'
import type { CaptionItem } from '../overlay/types'

interface UseFeedTypewriterArgs {
  items: CaptionItem[]
  advanceTyping: (id: string, sourceChars: number, translationChars: number) => void
  completeTyping: (id: string) => void
}

/** Characters revealed per RAF tick by source language. CJK = slower (more dense). */
function charsPerTickForLang(lang: string | undefined): number {
  if (!lang) return 2
  if (lang === 'ko' || lang === 'ja' || lang === 'zh') return 1
  return 2
}

/**
 * Walks the caption items queue. For the FIRST item with typing=true,
 * advances displayedSource and displayedTranslation by charsPerTickForLang
 * each frame until both reach their full text, then calls completeTyping
 * and moves on to the next.
 *
 * Hero is unaffected — this hook only touches feed items.
 */
export function useFeedTypewriter({
  items,
  advanceTyping,
  completeTyping,
}: UseFeedTypewriterArgs): void {
  const stateRef = useRef<{ id: string; src: number; tr: number } | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const tick = (): void => {
      const typingItem = items.find((item) => item.typing)
      if (!typingItem) {
        stateRef.current = null
        frameRef.current = null
        return
      }

      if (!stateRef.current || stateRef.current.id !== typingItem.id) {
        stateRef.current = { id: typingItem.id, src: 0, tr: 0 }
      }

      const step = charsPerTickForLang(typingItem.sourceLanguage)
      const cursor = stateRef.current
      const fullSrcLen = typingItem.fullSource.length
      const fullTrLen = typingItem.fullTranslation?.length ?? 0

      cursor.src = Math.min(cursor.src + step, fullSrcLen)
      // Translation starts when source is at least 30% done; CJK-aware ratio keeps both columns synced.
      const ratio = fullSrcLen === 0 ? 1 : cursor.src / fullSrcLen
      if (ratio >= 0.3 && fullTrLen > 0) {
        const targetTr = Math.ceil(ratio * fullTrLen)
        cursor.tr = Math.min(targetTr, fullTrLen)
      }

      const allDone = cursor.src >= fullSrcLen && cursor.tr >= fullTrLen
      if (allDone) {
        completeTyping(typingItem.id)
        stateRef.current = null
        frameRef.current = requestAnimationFrame(tick)
        return
      }

      advanceTyping(typingItem.id, cursor.src, cursor.tr)
      frameRef.current = requestAnimationFrame(tick)
    }

    if (frameRef.current === null && items.some((item) => item.typing)) {
      frameRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [items, advanceTyping, completeTyping])
}
