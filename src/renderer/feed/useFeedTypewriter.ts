import { useEffect, useRef } from 'react'
import type { CaptionItem } from '../overlay/types'

interface UseFeedTypewriterArgs {
  items: CaptionItem[]
  advanceTyping: (id: string, sourceChars: number, translationChars: number) => void
  completeTyping: (id: string) => void
}

/** Chat-like cadence: reveal a small number of characters based on elapsed time. */
function charsPerSecondForLang(lang: string | undefined): number {
  if (lang === 'ko' || lang === 'ja' || lang === 'zh') return 26
  return 36
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
  const stateRef = useRef<{
    id: string
    src: number
    tr: number
    srcCarry: number
    trCarry: number
    lastTickMs: number
  } | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const tick = (nowMs: number): void => {
      const typingItem = items.find((item) => item.typing)
      if (!typingItem) {
        stateRef.current = null
        frameRef.current = null
        return
      }

      if (!stateRef.current || stateRef.current.id !== typingItem.id) {
        // Seed from currently displayed lengths so a late translation patch
        // doesn't re-type source from zero.
        stateRef.current = {
          id: typingItem.id,
          src: typingItem.displayedSource.length,
          tr: typingItem.displayedTranslation.length,
          srcCarry: 0,
          trCarry: 0,
          lastTickMs: nowMs,
        }
      }

      const cursor = stateRef.current
      const fullSrcLen = typingItem.fullSource.length
      const fullTrLen = typingItem.fullTranslation?.length ?? 0
      const elapsedSeconds = Math.min(Math.max(nowMs - cursor.lastTickMs, 0), 120) / 1000
      cursor.lastTickMs = nowMs

      const charsPerSecond = charsPerSecondForLang(typingItem.sourceLanguage)
      cursor.srcCarry += charsPerSecond * elapsedSeconds
      const sourceStep = Math.floor(cursor.srcCarry)
      cursor.srcCarry = Math.max(cursor.srcCarry - sourceStep, 0)

      cursor.src = Math.min(cursor.src + sourceStep, fullSrcLen)
      if (cursor.src >= fullSrcLen) {
        if (fullTrLen > 0) {
          cursor.trCarry += charsPerSecond * elapsedSeconds
          const translationStep = Math.floor(cursor.trCarry)
          cursor.trCarry = Math.max(cursor.trCarry - translationStep, 0)
          cursor.tr = Math.min(cursor.tr + translationStep, fullTrLen)
        }
      } else if (fullTrLen > 0) {
        const ratio = cursor.src / fullSrcLen
        if (ratio >= 0.3) {
          const targetTr = Math.ceil(ratio * fullTrLen)
          cursor.tr = Math.min(targetTr, fullTrLen)
        }
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
