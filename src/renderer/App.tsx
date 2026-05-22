/**
 * autoMeetic — live meeting transcription + whiteboard powered by AI.
 *
 * Architecture ported from autopreso by Kun Chen (MIT License).
 * https://github.com/kunchenguid/autopreso
 *
 * Key patterns from autopreso:
 * - Audio session ID tracking (correlates audio → transcription)
 * - Analyser node for waveform visualization
 * - Caption pill with auto-truncation
 * - Delta-quiet flushing (handled server-side in proxy.mjs)
 * - Resample from native rate to 24kHz (handled in capture.ts)
 * - Excalidraw whiteboard with AI agent
 */
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SystemAudioCaptureService } from '../main/audio/capture'
import { PipelineHealthStore } from '../main/health/pipelineHealth'
import { RealtimeSttClient } from '../main/stt/realtimeClient'
import { TranscriptBus } from '../main/stt/transcriptBus'
import type { ViewportCommand, WhiteboardElement } from '../main/whiteboard/types'
import { ActionItemsPanel } from './actions/ActionItemsPanel'
import { isActionItem } from './actions/types'
import { useActionItemsStore } from './actions/useActionItemsStore'
import { AnswerAssistCard } from './answer-assist/AnswerAssistCard'
import { useAnswerAssistStore } from './answer-assist/useAnswerAssistStore'
import { isElectron } from './api'
import './App.css'
import { ElectronSttClient } from './electronSttClient'
import { useFeedTypewriter } from './feed/useFeedTypewriter'
import { GlossaryPanel } from './glossary/GlossaryPanel'
import { MemoryLibraryPanel } from './library/MemoryLibraryPanel'
import { CaptionOverlay } from './overlay/CaptionOverlay'
import { useCaptionStore } from './overlay/useCaptionStore'
import SourceBar from './shell/SourceBar'
import { useThemeStore, type Theme } from './theme/useThemeStore'
import { ExcalidrawCanvas } from './whiteboard/ExcalidrawCanvas'
import { WhiteboardModal } from './whiteboard/WhiteboardModal'
import { WhiteboardLabelLangSelect } from './whiteboard/WhiteboardLabelLangSelect'

const LANGUAGE_OPTIONS = [
  { code: 'auto', label: 'Auto detect' },
  { code: 'ko', label: 'Korean' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
]

const LANGUAGE_LABEL_BY_CODE = new Map(
  LANGUAGE_OPTIONS.map((language) => [language.code, language.label])
)
const META_TRANSLATION_RE =
  /\b(this text appears|let me translate|translation|translate it|appears to be a mix)\b/i
const HERO_CAPTION_MAX_WORDS = 16
const HERO_CAPTION_MAX_CHARS = 120
const DEFAULT_STT_LANGUAGE = 'auto'
const DEFAULT_TRANSLATION_TARGET = 'ko'
const TRANSLATION_TARGET_STORAGE_KEY = 'automeetic.translationTarget'
const TRANSLATION_TARGET_OPTIONS = new Set([
  'off',
  ...LANGUAGE_OPTIONS.filter((language) => language.code !== 'auto').map(
    (language) => language.code
  ),
])
function compactHeroCaption(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= HERO_CAPTION_MAX_CHARS) return normalized

  const words = normalized.split(' ')
  let tail = words.slice(-HERO_CAPTION_MAX_WORDS).join(' ')

  while (tail.length > HERO_CAPTION_MAX_CHARS) {
    const nextSpaceIndex = tail.indexOf(' ')
    if (nextSpaceIndex === -1) break
    tail = tail.slice(nextSpaceIndex + 1)
  }

  return tail === normalized ? tail : `...${tail}`
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function conflictsWithLockedLanguage(text: string, lockedLanguage: string): boolean {
  const hangul = countMatches(text, /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g)
  const kana = countMatches(text, /[\u3040-\u30ff]/g)
  const han = countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/g)
  const latin = countMatches(text, /[A-Za-z]/g)

  if (META_TRANSLATION_RE.test(text)) return true
  if (lockedLanguage === 'ko') return kana >= 2 && hangul < 2
  if (lockedLanguage === 'ja') return hangul >= 2 && kana < 2
  if (lockedLanguage === 'zh') return (hangul >= 2 || kana >= 2) && han < 2
  if (lockedLanguage === 'en') return hangul + kana + han >= 4 && latin < 8
  return false
}

function isWhiteboardElement(value: unknown): value is WhiteboardElement {
  if (!value || typeof value !== 'object') return false
  const element = value as Partial<WhiteboardElement>
  return typeof element.id === 'string' && typeof element.type === 'string'
}

function getInitialTranslationTarget(): string {
  const storedTarget = window.localStorage.getItem(TRANSLATION_TARGET_STORAGE_KEY)
  if (storedTarget && TRANSLATION_TARGET_OPTIONS.has(storedTarget)) return storedTarget
  return DEFAULT_TRANSLATION_TARGET
}

const THEME_OPTIONS: ReadonlyArray<{
  value: Theme
  label: string
  title: string
  icon: React.ReactNode
}> = [
  {
    value: 'light',
    label: 'Light',
    title: 'Light — Linear-grade pro',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="2.4" />
        <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1 1M10.4 10.4l1 1M2.6 11.4l1-1M10.4 3.6l1-1" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    title: 'Dark — Linear-grade pro',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8.2A5 5 0 1 1 5.8 2 4 4 0 0 0 12 8.2z" />
      </svg>
    ),
  },
]

function ThemeToggle({
  theme,
  onSelect,
}: {
  theme: Theme
  onSelect: (next: Theme) => void
}) {
  return (
    <div className="v4p-theme-toggle" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`v4p-theme-btn ${theme === option.value ? 'on' : ''}`}
          onClick={() => onSelect(option.value)}
          title={option.title}
          aria-pressed={theme === option.value}
          aria-label={option.label}
        >
          <span className="v4p-theme-icon" aria-hidden="true">
            {option.icon}
          </span>
        </button>
      ))}
    </div>
  )
}

function useGlossarySuggestionCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI?.glossary?.suggestions
    if (!api) return
    const refresh = () => {
      void api.count().then((n) => {
        if (!cancelled) setCount(n)
      })
    }
    refresh()
    const unsub = api.onUpdated(refresh)
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  return count
}

type PipelineStatus = 'connected' | 'degraded' | 'disconnected'

function PipelineStage({
  name,
  status,
  message,
}: {
  name: string
  status: PipelineStatus
  message?: string
}) {
  const cls =
    status === 'connected'
      ? 'cc-pipeline-stage ok'
      : status === 'degraded'
        ? 'cc-pipeline-stage warn'
        : 'cc-pipeline-stage idle'
  const note = message ?? (status === 'connected' ? 'ok' : status)
  return (
    <span className={cls} title={`${name}: ${message ?? status}`}>
      <span className="cc-pipeline-dot" />
      <span className="cc-pipeline-name">{name}</span>
      <span className="cc-pipeline-note">{note}</span>
    </span>
  )
}

function App() {
  const shellRef = useRef<HTMLElement | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [canvasResetVersion, setCanvasResetVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [healthTick, setHealthTick] = useState(0)
  const [activeAudioMs, setActiveAudioMs] = useState(0)
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null)
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [whiteboardConnected, setWhiteboardConnected] = useState(false)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [sttLanguage, setSttLanguage] = useState(DEFAULT_STT_LANGUAGE)
  const [translationTarget, setTranslationTarget] = useState(getInitialTranslationTarget)
  const [languageLock, setLanguageLock] = useState<string | null>(null)
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  // V4: collapsible right shelf — 'whiteboard' | 'actions' | 'closed'
  const [shelf, setShelf] = useState<'whiteboard' | 'actions' | 'closed'>('whiteboard')
  const [whiteboardMaximized, setWhiteboardMaximized] = useState(false)
  const [memoryLibraryOpen, setMemoryLibraryOpen] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const glossarySuggestionCount = useGlossarySuggestionCount()
  const enColRef = useRef<HTMLDivElement>(null)
  const koColRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef(false)
  const programmaticScrollUntilRef = useRef(0)
  const {
    items,
    currentPartial,
    applyPartial,
    appendProcessed,
    patchSource,
    patchTranslation,
    advanceTyping,
    completeTyping,
    clear,
    getRecentTranscript,
  } = useCaptionStore()
  useFeedTypewriter({ items, advanceTyping, completeTyping })
  const [captionText, setCaptionText] = useState('')
  const { theme, setTheme } = useThemeStore()
  const answerAssist = useAnswerAssistStore()
  const {
    items: actionItemList,
    addSuggested: addSuggestedActionItems,
    accept: acceptActionItem,
    dismiss: dismissActionItem,
    markDone: markActionItemDone,
    updateItem: updateActionItem,
    reset: resetActionItems,
  } = useActionItemsStore()

  // ── Whiteboard state (autopreso pattern) ──────────────────────────────────
  const [whiteboardElements, setWhiteboardElements] = useState<WhiteboardElement[]>([])
  const [viewportCommand, setViewportCommand] = useState<ViewportCommand | null>(null)
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'error'>('idle')
  const whiteboardWsRef = useRef<WebSocket | null>(null)
  const languageVotesRef = useRef<Record<string, number>>({})
  const lockedLanguageRef = useRef<string | null>(null)
  const reconnectLanguageRef = useRef<string | null>(null)
  const acceptedFinalTranscriptIdsRef = useRef<Set<string>>(new Set())
  const rejectedFinalTranscriptIdsRef = useRef<Set<string>>(new Set())
  const recentFinalTextsRef = useRef<Array<{ normalized: string; createdAtMs: number }>>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const captionTimerRef = useRef<number | null>(null)

  // Stable service instances — same lifecycle pattern as autopreso
  const bus = useMemo(() => new TranscriptBus(), [])
  const capture = useMemo(() => new SystemAudioCaptureService(), [])
  const sttClient = useMemo(
    () => (isElectron ? new ElectronSttClient(bus) : new RealtimeSttClient(bus)),
    [bus]
  )
  const health = useMemo(() => new PipelineHealthStore(), [])

  const updateHealth = useCallback(
    (
      stage: 'capture' | 'stt' | 'translation',
      status: 'connected' | 'degraded' | 'disconnected',
      message?: string
    ) => {
      health.update(stage, status, message)
      setHealthTick((v) => v + 1)
    },
    [health]
  )

  useEffect(() => {
    const offCapture = capture.subscribe((chunk) => sttClient.ingest(chunk))

    return () => {
      offCapture()
      capture.stop()
      sttClient.disconnect()
    }
  }, [capture, sttClient])

  // Wire Electron IPC STT events to caption store
  useEffect(() => {
    if (!isElectron) return
    const api = window.electronAPI
    if (!api) return

    const offPartial = api.onSttPartial((text) => {
      applyPartial(text)
      const trimmed = text.trim()
      if (trimmed) {
        if (captionTimerRef.current !== null) {
          window.clearTimeout(captionTimerRef.current)
          captionTimerRef.current = null
        }
        setCaptionText(trimmed)
      }
    })

    const offCommitted = api.onSttCommitted((text) => {
      const trimmed = (text ?? '').trim()
      if (trimmed) {
        if (captionTimerRef.current !== null) {
          window.clearTimeout(captionTimerRef.current)
        }
        setCaptionText(trimmed)
        captionTimerRef.current = window.setTimeout(() => {
          setCaptionText('')
          captionTimerRef.current = null
        }, 3500)
      }
    })

    const offProcessed = api.onSttProcessed((event) => {
      if (!event?.turns?.length) return
      appendProcessed(event.turns)
    })

    const offSourcePatch = api.onSttSourcePatch((event) => {
      if (!event?.id || !event.text) return
      patchSource(event.id, event.text)
    })

    const offTranslationPatch = api.onSttTranslationPatch((event) => {
      if (!event?.id || !event.translation) return
      patchTranslation(event.id, event.translation)
    })

    return () => {
      offPartial()
      offCommitted()
      offProcessed()
      offSourcePatch()
      offTranslationPatch()
    }
  }, [applyPartial, appendProcessed, patchSource, patchTranslation])

  // V4: auto-scroll bilingual columns to bottom when content changes.
  useEffect(() => {
    if (!autoScroll) return
    const en = enColRef.current
    const ko = koColRef.current
    requestAnimationFrame(() => {
      programmaticScrollUntilRef.current = performance.now() + 250
      syncingScrollRef.current = true
      if (en) en.scrollTop = en.scrollHeight
      if (ko) ko.scrollTop = ko.scrollHeight
      requestAnimationFrame(() => {
        syncingScrollRef.current = false
      })
    })
  }, [items, currentPartial, autoScroll])

  // V4: keep the EN and KO column scroll positions linked, and track
  // manual scrolling to toggle the auto-scroll state.
  useEffect(() => {
    const en = enColRef.current
    const ko = koColRef.current
    if (!en) return

    const updateAutoScroll = (el: HTMLDivElement) => {
      if (syncingScrollRef.current || performance.now() < programmaticScrollUntilRef.current) {
        return
      }
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(isNearBottom)
    }

    const link = (from: HTMLDivElement, to: HTMLDivElement | null) => () => {
      updateAutoScroll(from)
      if (!to || syncingScrollRef.current) return
      syncingScrollRef.current = true
      const denom = from.scrollHeight - from.clientHeight || 1
      const ratio = from.scrollTop / denom
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
      programmaticScrollUntilRef.current = performance.now() + 120
      requestAnimationFrame(() => {
        syncingScrollRef.current = false
      })
    }

    const onEn = link(en, ko)
    en.addEventListener('scroll', onEn, { passive: true })
    let onKo: (() => void) | null = null
    if (ko) {
      onKo = link(ko, en)
      ko.addEventListener('scroll', onKo, { passive: true })
    }
    return () => {
      en.removeEventListener('scroll', onEn)
      if (ko && onKo) ko.removeEventListener('scroll', onKo)
    }
  }, [translationTarget])

  useEffect(() => {
    if (!running || sttLanguage !== 'auto' || !languageLock) return
    if (reconnectLanguageRef.current === languageLock) return
    reconnectLanguageRef.current = languageLock

    // Keep the active STT stream stable; only update lock status in UI.
    updateHealth('stt', 'connected', `locked ${languageLock}`)
  }, [languageLock, running, sttLanguage, updateHealth])

  // ── Whiteboard WebSocket connection (autopreso pattern) ───────────────────
  useEffect(() => {
    // Electron mode: listen for whiteboard events via IPC from main process
    if (isElectron) {
      const api = window.electronAPI
      if (!api) return

      const offUpdate = api.onWhiteboardUpdate((data: unknown) => {
        const msg = data as { elements?: unknown[] }
        if (Array.isArray(msg.elements)) {
          const filtered = msg.elements.filter(isWhiteboardElement) as WhiteboardElement[]
          setWhiteboardElements(filtered)
        }
      })

      const offViewport = api.onWhiteboardViewport((data: unknown) => {
        setViewportCommand(data as ViewportCommand)
      })

      const offStatus = api.onWhiteboardAgentStatus((data: unknown) => {
        const msg = data as { status?: string }
        if (msg.status === 'thinking') setAgentStatus('thinking')
        else if (msg.status === 'error') setAgentStatus('error')
        else setAgentStatus('idle')
      })

      let active = true
      queueMicrotask(() => {
        if (active) setWhiteboardConnected(true)
      })

      return () => {
        active = false
        offUpdate()
        offViewport()
        offStatus()
        setWhiteboardConnected(false)
      }
    }

    let ws: WebSocket | null = null
    const connectTimer = window.setTimeout(() => {
      const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/whiteboard`
      ws = new WebSocket(wsUrl)
      whiteboardWsRef.current = ws

      ws.onopen = () => {
        setWhiteboardConnected(true)
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data as string) as Record<string, unknown>
        } catch {
          return
        }

        if (msg.type === 'whiteboard:update' && Array.isArray(msg.elements)) {
          const filtered = msg.elements.filter(isWhiteboardElement) as WhiteboardElement[]
          setWhiteboardElements(filtered)
        }

        if (msg.type === 'whiteboard:viewport') {
          setViewportCommand(msg as unknown as ViewportCommand)
        }

        if (msg.type === 'whiteboard:agent-status') {
          const status = msg.status as string
          if (status === 'thinking') setAgentStatus('thinking')
          else if (status === 'error') setAgentStatus('error')
          else setAgentStatus('idle')
        }
      }

      ws.onclose = () => {
        whiteboardWsRef.current = null
        setWhiteboardConnected(false)
      }
    }, 0)

    return () => {
      window.clearTimeout(connectTimer)
      if (ws) {
        ws.close()
        whiteboardWsRef.current = null
      }
      setWhiteboardConnected(false)
    }
  }, [])

  useEffect(() => {
    if (!isElectron) return
    const api = window.electronAPI
    if (!api) return

    const offSuggested = api.onActionItemsSuggested((data: unknown) => {
      const msg = data as { items?: unknown[] }
      if (!Array.isArray(msg.items)) return
      addSuggestedActionItems(msg.items.filter(isActionItem))
    })
    const offReset = api.onActionItemsReset(() => {
      resetActionItems()
    })

    return () => {
      offSuggested()
      offReset()
    }
  }, [addSuggestedActionItems, resetActionItems])

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(
    () => () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
      if (captionTimerRef.current !== null) {
        window.clearTimeout(captionTimerRef.current)
      }
    },
    []
  )

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      const target = shellRef.current
      if (target?.requestFullscreen) await target.requestFullscreen()
    } catch {
      // No-op: fullscreen is best-effort for sharing mode.
    }
  }, [])

  // ── Feed transcripts to whiteboard agent ──────────────────────────────────
  useEffect(() => {
    if (!running) return

    const offTranscript = bus.onTranscript((segment) => {
      if (!segment.isFinal) return
      // Skip language-conflicting transcripts but do NOT re-check dedup
      // (the feed handler already recorded the ID in acceptedFinalTranscriptIdsRef)
      const text = segment.text.trim()
      if (!text) return
      const preferredLang = sttLanguage === 'auto' ? lockedLanguageRef.current : sttLanguage
      if (preferredLang && conflictsWithLockedLanguage(text, preferredLang)) return

      const ws = whiteboardWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        const diagramLabelLang =
          window.localStorage.getItem('automeetic.diagramLabelLanguage') || null
        ws.send(
          JSON.stringify({
            type: 'whiteboard:agent-run',
            transcript: text,
            labelLanguage: diagramLabelLang,
          })
        )
      }
    })

    return offTranscript
  }, [running, bus, sttLanguage])

  /**
   * Handle user edits on Excalidraw canvas — push to server.
   * Ported from autopreso/public/app.js handleExcalidrawChange()
   */
  const handleWhiteboardChange = useCallback((elements: WhiteboardElement[]) => {
    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:user-elements', elements }))
    }
  }, [])

  const handleWhiteboardScreenshot = useCallback((image: string) => {
    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:screenshot', image }))
    }
  }, [])

  const healthSnapshot = health.getSnapshot()
  const snapshot = {
    ...healthSnapshot,
    translation: {
      ...healthSnapshot.translation,
      status: translationTarget === 'off' ? 'disconnected' : 'connected',
      message: translationTarget === 'off' ? 'not connected' : `to ${translationTarget}`,
    },
  } as const
  void healthTick

  const transcriptCount = items.length
  const sourceWordCount = useMemo(
    () =>
      items.reduce((total, item) => {
        const words = item.sourceText.trim().split(/\s+/).filter(Boolean).length
        return total + words
      }, 0),
    [items]
  )
  const currentRunMs = running && runStartMs !== null ? Math.max(clockMs - runStartMs, 0) : 0
  const totalAudioMs = activeAudioMs + currentRunMs

  const formatDuration = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }, [])

  /**
   * Start listening — connect STT proxy, then start capture.
   * Mirrors autopreso/public/app.js startListening() flow.
   */
  const onStart = useCallback(async () => {
    if (running || starting) return
    setError(null)
    setStarting(true)

    try {
      // 1. Connect to transcription proxy
      updateHealth('stt', 'degraded', 'connecting...')
      await sttClient.connect(sttLanguage)
      updateHealth('stt', 'connected', `OpenAI Realtime ready (${sttLanguage})`)

      // 2. Start system audio capture (prompts user to share tab/window)
      updateHealth('capture', 'degraded', 'requesting display media...')
      await capture.start()
      updateHealth('capture', 'connected', 'system audio active')
      if (sessionStartMs === null) setSessionStartMs(Date.now())
      setRunStartMs(Date.now())

      // 3. Expose analyser for waveform visualization (autopreso pattern)
      setAnalyser(capture.analyser ?? null)

      setRunning(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      updateHealth('stt', 'disconnected', msg)
      updateHealth('capture', 'disconnected', 'not started')
    } finally {
      setStarting(false)
    }
  }, [capture, running, sessionStartMs, starting, sttClient, sttLanguage, updateHealth])

  /**
   * Stop listening — mirrors autopreso/public/app.js stopListening().
   */
  const onStop = useCallback(() => {
    if (runStartMs !== null) {
      const startedAt = runStartMs
      setActiveAudioMs((ms) => ms + (Date.now() - startedAt))
      setRunStartMs(null)
    }
    capture.stop()
    sttClient.disconnect()
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current)
      captionTimerRef.current = null
    }
    setCaptionText('')
    setAnalyser(null)
    updateHealth('capture', 'disconnected', 'stopped')
    updateHealth('stt', 'disconnected', 'stopped')
    setRunning(false)
  }, [capture, runStartMs, sttClient, updateHealth])

  const resetSession = useCallback(() => {
    if (!resetConfirming) {
      setResetConfirming(true)
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = window.setTimeout(() => {
        setResetConfirming(false)
        resetTimeoutRef.current = null
      }, 2500)
      return
    }

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }

    if (running) onStop()
    clear()
    resetActionItems()
    if (isElectron) {
      void window.electronAPI?.resetActionItems()
      void window.electronAPI?.resetWhiteboard()
      void window.electronAPI?.resetTranscriptPostProcessor()
    }
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current)
      captionTimerRef.current = null
    }
    setCaptionText('')
    setError(null)
    setResetConfirming(false)
    setCanvasResetVersion((v) => v + 1)
    setWhiteboardElements([])
    setViewportCommand(null)
    setAgentStatus('idle')
    setWhiteboardMaximized(false)
    setLanguageLock(null)
    setDetectedLanguage(null)
    lockedLanguageRef.current = null
    reconnectLanguageRef.current = null
    languageVotesRef.current = {}
    acceptedFinalTranscriptIdsRef.current.clear()
    rejectedFinalTranscriptIdsRef.current.clear()
    recentFinalTextsRef.current = []
    setActiveAudioMs(0)
    setRunStartMs(null)
    setSessionStartMs(null)
    updateHealth('capture', 'disconnected', 'session reset')
    updateHealth('stt', 'disconnected', 'session reset')
    // translation health is config-driven; let the translationTarget effect manage it

    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:reset' }))
    }
  }, [clear, onStop, resetActionItems, resetConfirming, running, updateHealth])

  const triggerAnswerAssist = useCallback(() => {
    if (answerAssist.status === 'loading' || answerAssist.status === 'streaming') return
    const transcript = getRecentTranscript(180_000)
    if (!transcript) return
    const sourceLang =
      sttLanguage === 'auto' ? (languageLock ?? detectedLanguage ?? 'en') : sttLanguage
    void answerAssist.requestAnswer(transcript, sourceLang, translationTarget)
  }, [
    answerAssist,
    detectedLanguage,
    getRecentTranscript,
    languageLock,
    sttLanguage,
    translationTarget,
  ])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        triggerAnswerAssist()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [triggerAnswerAssist])

  // ── V4 Bilingual Editorial layout ────────────────────────────────────────
  const sourceLang =
    sttLanguage === 'auto' ? (languageLock ?? detectedLanguage ?? 'auto') : sttLanguage
  const targetLang = translationTarget
  const showTranslationColumn = translationTarget !== 'off' && targetLang !== sourceLang
  const hasFeedContent = items.length > 0
  const heroSourceText = compactHeroCaption(captionText)
  const heroDurationLabel = sessionStartMs ? formatDuration(totalAudioMs) : '00:00'
  const langCode = (code: string) => (code === 'auto' || code === 'off' ? '—' : code.toUpperCase())
  const answerBusy = answerAssist.status === 'loading' || answerAssist.status === 'streaming'

  const onLanguageChange = (next: string): void => {
    setSttLanguage(next)
    setLanguageLock(null)
    setDetectedLanguage(null)
    lockedLanguageRef.current = null
    reconnectLanguageRef.current = null
    languageVotesRef.current = {}
    acceptedFinalTranscriptIdsRef.current.clear()
    rejectedFinalTranscriptIdsRef.current.clear()
    recentFinalTextsRef.current = []
    if (isElectron && window.electronAPI) {
      void window.electronAPI.setTranscriptLanguages({
        sourceLanguage: next,
        targetLanguage: translationTarget,
      })
    }
  }

  const onTranslationChange = (next: string): void => {
    window.localStorage.setItem(TRANSLATION_TARGET_STORAGE_KEY, next)
    setTranslationTarget(next)
    if (isElectron && window.electronAPI) {
      void window.electronAPI.setTranscriptLanguages({
        sourceLanguage: sttLanguage,
        targetLanguage: next,
      })
    }
  }

  useEffect(() => {
    if (isElectron && window.electronAPI) {
      void window.electronAPI.setTranscriptLanguages({
        sourceLanguage: sttLanguage,
        targetLanguage: translationTarget,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="v4-app" ref={shellRef} data-running={running ? 'true' : 'false'}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="v4p-head">
        <div className="v4p-head-left">
          <span className={`v4p-live ${running ? 'on' : 'off'}`}>
            <span className="v4p-live-dot" />
            <span className="v4p-live-text">
              {running ? 'Live' : starting ? 'Starting' : 'Idle'}
            </span>
            <span className="v4p-live-time amw-mono">{heroDurationLabel}</span>
          </span>
          <div className="cc-pipeline" role="group" aria-label="Pipeline status">
            <PipelineStage
              name="Capture"
              status={snapshot.capture.status}
              message={snapshot.capture.message}
            />
            <PipelineStage
              name="STT"
              status={snapshot.stt.status}
              message={snapshot.stt.message}
            />
            <PipelineStage
              name="Translate"
              status={snapshot.translation.status}
              message={snapshot.translation.message}
            />
            <PipelineStage
              name="Agent"
              status={
                agentStatus === 'thinking'
                  ? 'connected'
                  : agentStatus === 'error'
                    ? 'degraded'
                    : whiteboardConnected
                      ? 'connected'
                      : 'disconnected'
              }
              message={
                agentStatus === 'thinking'
                  ? 'generating'
                  : agentStatus === 'error'
                    ? 'error'
                    : whiteboardConnected
                      ? 'ready'
                      : 'idle'
              }
            />
          </div>
        </div>

        <div className="v4p-head-mid">
          <span className="v4p-eyebrowtxt">Session</span>
          <h1 className="v4p-title">AutoMeetic</h1>
        </div>

        <div className="v4p-head-right">
          <ThemeToggle theme={theme} onSelect={setTheme} />
          <div className="v4p-lang">
            <select
              className="v4p-lang-select"
              value={sttLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              disabled={running || starting}
              aria-label="Input language"
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code === 'auto' ? 'Auto' : language.code.toUpperCase()}
                </option>
              ))}
            </select>
            <em>→</em>
            <select
              className="v4p-lang-select"
              value={translationTarget}
              onChange={(event) => onTranslationChange(event.target.value)}
              aria-label="Translation target"
            >
              <option value="off">Off</option>
              {LANGUAGE_OPTIONS.filter((language) => language.code !== 'auto').map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <button
            className={`v4p-record ${running ? 'on' : ''}`}
            type="button"
            onClick={() => {
              if (running) onStop()
              else void onStart()
            }}
            disabled={starting}
            title={running ? 'Stop listening' : 'Start listening'}
          >
            <span className="v4p-record-icon" aria-hidden="true">
              {running ? (
                <svg width="9" height="9" viewBox="0 0 9 9">
                  <rect width="9" height="9" rx="1.5" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <circle cx="5" cy="5" r="4" fill="currentColor" />
                </svg>
              )}
            </span>
            <span className="v4p-record-text">
              {running ? 'Stop' : starting ? 'Starting…' : 'Start'}
            </span>
          </button>

          <button
            className={`v4p-iconbtn ghost ${shelf !== 'closed' ? 'on' : ''}`}
            type="button"
            onClick={() => setShelf(shelf === 'closed' ? 'whiteboard' : 'closed')}
            title={shelf === 'closed' ? 'Show panel' : 'Hide panel'}
            aria-label="Toggle right panel"
            aria-pressed={shelf !== 'closed'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <rect x="1.25" y="2.5" width="11.5" height="9" rx="1.5" />
              <line x1="9" y1="2.5" x2="9" y2="11.5" />
            </svg>
          </button>

          <button
            className={`v4p-iconbtn ghost ${memoryLibraryOpen ? 'on' : ''}`}
            type="button"
            onClick={() => setMemoryLibraryOpen(true)}
            title="Meeting library"
            aria-label="Meeting library"
            aria-pressed={memoryLibraryOpen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 2.5h3.2L6.3 4H12v7.5H2z" />
              <path d="M4 7h6M4 9h4" />
            </svg>
          </button>

          <button
            className={`v4p-iconbtn ghost ${glossaryOpen ? 'on' : ''}`}
            type="button"
            onClick={() => setGlossaryOpen(true)}
            title="Glossary"
            aria-label="Glossary"
            aria-pressed={glossaryOpen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 1.5h7.5a.5.5 0 0 1 .5.5v9.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" />
              <path d="M2.5 9.5h8M6.75 1.5v10" />
            </svg>
            {glossarySuggestionCount > 0 && (
              <span className="v4p-iconbtn-badge amw-mono">{glossarySuggestionCount}</span>
            )}
          </button>

          <button
            className="v4p-iconbtn ghost"
            type="button"
            onClick={() => {
              void toggleFullscreen()
            }}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            aria-label="Toggle fullscreen"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {isFullscreen ? (
                <path d="M5 1v4H1M8 12V8h4M1 8h4v4M12 5H8V1" />
              ) : (
                <path d="M1 5V1h4M12 5V1H8M1 8v4h4M12 8v4H8" />
              )}
            </svg>
          </button>

          <button
            className="v4p-iconbtn"
            type="button"
            onClick={triggerAnswerAssist}
            disabled={!running || answerBusy}
            title="Answer Assist (Ctrl+Shift+A)"
            aria-label="Answer Assist"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            >
              <path d="M7 1.5L8.5 5l3.5.5-2.5 2.4.6 3.5L7 9.8 3.9 11.4l.6-3.5L2 5.5 5.5 5 7 1.5z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Source bar ─────────────────────────────────────────── */}
      <SourceBar
        running={running}
        analyser={analyser}
        error={error}
        resetConfirming={resetConfirming}
        resetSession={resetSession}
        transcriptCount={transcriptCount}
        sourceWordCount={sourceWordCount}
      />

      {/* ── Main: columns + shelf ─────────────────────────────── */}
      <div className="v4p-main">
        <section className="v4p-cols">
          <div className="v4p-col">
            <div className="v4p-col-hd">
              <span className="v4p-col-mark">{langCode(sourceLang)}</span>
              <span className="v4p-col-name">
                <em>Original</em>
                {languageLock && <> · {LANGUAGE_LABEL_BY_CODE.get(languageLock) ?? languageLock}</>}
                {!languageLock && detectedLanguage && (
                  <>
                    {' '}
                    · detecting {LANGUAGE_LABEL_BY_CODE.get(detectedLanguage) ?? detectedLanguage}
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
                  <em>Translation</em> · {LANGUAGE_LABEL_BY_CODE.get(targetLang) ?? targetLang}
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

        {/* Right shelf */}
        {shelf !== 'closed' && (
          <aside className="v4p-shelf">
            <div className="v4p-shelf-tabs">
              <button
                className={`v4p-shelf-tab ${shelf === 'whiteboard' ? 'on' : ''}`}
                onClick={() => setShelf('whiteboard')}
              >
                Whiteboard
                {whiteboardElements.length > 0 && (
                  <span className="v4p-shelf-tab-badge amw-mono">
                    {whiteboardElements.length}
                  </span>
                )}
              </button>
              <button
                className={`v4p-shelf-tab ${shelf === 'actions' ? 'on' : ''}`}
                onClick={() => setShelf('actions')}
              >
                Actions
                {actionItemList.length > 0 && (
                  <span className="v4p-shelf-tab-badge amw-mono">{actionItemList.length}</span>
                )}
              </button>
              {shelf === 'whiteboard' && <WhiteboardLabelLangSelect />}
              <button
                className="v4p-shelf-x"
                onClick={() => setShelf('closed')}
                title="Close panel"
                aria-label="Close panel"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinecap="round"
                >
                  <path d="M2 2l7 7M9 2l-7 7" />
                </svg>
              </button>
            </div>
            <div className="v4p-shelf-body">
              <div
                className={`v4p-shelf-panel ${shelf === 'whiteboard' ? 'on' : ''}`}
                aria-hidden={shelf !== 'whiteboard'}
              >
                <div className="v4p-wb">
                  <ExcalidrawCanvas
                    key={`canvas-${canvasResetVersion}`}
                    elements={whiteboardElements}
                    viewportCommand={viewportCommand}
                    compact
                    onMaximize={() => setWhiteboardMaximized(true)}
                  />
                  {whiteboardElements.length === 0 && (
                    <div className="v4p-wb-empty">
                      <em>Diagram appears here</em> as the agent finds key concepts.
                    </div>
                  )}
                  {agentStatus === 'thinking' && (
                    <div className="v4p-wb-badge">
                      <span className="v4p-wb-spinner" /> Agent thinking
                    </div>
                  )}
                  {agentStatus === 'error' && (
                    <div className="v4p-wb-badge error">Diagram failed</div>
                  )}
                </div>
              </div>
              <div
                className={`v4p-shelf-panel ${shelf === 'actions' ? 'on' : ''}`}
                aria-hidden={shelf !== 'actions'}
              >
                <ActionItemsPanel
                  items={actionItemList}
                  onAccept={acceptActionItem}
                  onDismiss={dismissActionItem}
                  onDone={markActionItemDone}
                  onUpdate={updateActionItem}
                />
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ── Broadcast lower-third console ─────────────────────── */}
      <footer className={`cc-console ${running ? 'live' : ''}`}>
        <div className="cc-console-meta">
          <div className="cc-console-line">
            {running && <span className="cc-console-pulse" aria-hidden="true" />}
            <span className="cc-console-label">
              {running ? 'Now speaking' : 'Last caption'}
            </span>
            <span className="cc-console-sep">·</span>
            <span className="cc-console-source">System audio</span>
            <span className="cc-console-sep">·</span>
            <span className="amw-mono cc-console-time">{heroDurationLabel}</span>
          </div>
          <div className="cc-console-stats">
            <span>
              <strong className="amw-mono">{transcriptCount}</strong> captions
            </span>
            <span className="cc-console-sep">·</span>
            <span>
              <strong className="amw-mono">{sourceWordCount}</strong> words
            </span>
          </div>
        </div>

        <div className="cc-console-cap">
          <div className="cc-console-cap-src">
            {heroSourceText || (
              <span className="cc-console-cap-placeholder">
                {running
                  ? 'Listening…'
                  : 'Press Start to begin a session. Share any browser tab or window with audio.'}
              </span>
            )}
          </div>
        </div>

        <div className="cc-console-aside">
          <button
            className="cc-console-ask"
            type="button"
            onClick={triggerAnswerAssist}
            disabled={!running || answerBusy}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M7 1L8.5 5L13 5.5L9.5 8.5L10.5 13L7 10.5L3.5 13L4.5 8.5L1 5.5L5.5 5L7 1z" />
            </svg>
            <span>{answerBusy ? 'Thinking…' : 'Ask'}</span>
            <kbd>⌃⇧A</kbd>
          </button>
        </div>
      </footer>

      {/* Answer Assist overlay */}
      {answerAssist.status !== 'idle' && (
        <div className="v4p-aa-overlay">
          <AnswerAssistCard
            status={answerAssist.status}
            searchQuery={answerAssist.searchQuery}
            answer={answerAssist.answer}
            answerKo={answerAssist.answerKo}
            targetLang={translationTarget}
            errorMessage={answerAssist.errorMessage}
            onDismiss={answerAssist.dismiss}
            onCopy={answerAssist.copyAnswer}
          />
        </div>
      )}

      {/* Caption overlay for screen sharing — kept for fullscreen presenters */}
      {isFullscreen && <CaptionOverlay currentPartial={captionText} />}

      <WhiteboardModal
        open={whiteboardMaximized}
        elements={whiteboardElements}
        viewportCommand={viewportCommand}
        agentStatus={agentStatus}
        canvasResetVersion={canvasResetVersion}
        onElementsChange={handleWhiteboardChange}
        onScreenshot={handleWhiteboardScreenshot}
        onClose={() => setWhiteboardMaximized(false)}
      />

      <MemoryLibraryPanel open={memoryLibraryOpen} onClose={() => setMemoryLibraryOpen(false)} />
      <GlossaryPanel open={glossaryOpen} meetingId={null} onClose={() => setGlossaryOpen(false)} />
    </main>
  )
}

export default App
