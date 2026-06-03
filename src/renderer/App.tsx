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
import { useTranslation } from 'react-i18next'
import { SystemAudioCaptureService } from '../main/audio/capture'
import { RealtimeSttClient } from '../main/stt/realtimeClient'
import { TranscriptBus } from '../main/stt/transcriptBus'
import type { ViewportCommand, WhiteboardElement } from '../main/whiteboard/types'
import type { AskMindMapPayload } from '../main/whiteboard/askMindMap'
import { isActionItem } from './actions/types'
import { useActionItemsStore } from './actions/useActionItemsStore'
import { AnswerAssistCard } from './answer-assist/AnswerAssistCard'
import { useAnswerAssistStore } from './answer-assist/useAnswerAssistStore'
import { isElectron } from './api'
import './App.css'
import { ElectronSttClient } from './electronSttClient'
import { useFeedTypewriter } from './feed/useFeedTypewriter'
import { LanguagePicker } from './i18n/LanguagePicker'
import { CaptionOverlay } from './overlay/CaptionOverlay'
import { useCaptionStore } from './overlay/useCaptionStore'
import { useSlackArm } from './slack/useSlackArm'
import { RightShelf } from './shell/RightShelf'
import { SourceBar } from './shell/SourceBar'
import { TranscriptColumns } from './shell/TranscriptColumns'
import { useAnswerAssistHotkey } from './shell/useAnswerAssistHotkey'
import { useClockMs } from './shell/useClockMs'
import { useFullscreenState } from './shell/useFullscreenState'
import { usePanels, type Shelf } from './shell/usePanels'
import { usePipelineHealth } from './shell/usePipelineHealth'
import { useTranscriptScrollSync } from './shell/useTranscriptScrollSync'
import { AppModals } from './shell/AppModals'
import { useThemeStore, type Theme } from './theme/useThemeStore'

const LANGUAGE_OPTIONS = [
  { code: 'auto', labelKey: 'shell.language.autoDetect' },
  { code: 'ko', labelKey: 'shell.language.korean' },
  { code: 'en', labelKey: 'shell.language.english' },
  { code: 'ja', labelKey: 'shell.language.japanese' },
  { code: 'zh', labelKey: 'shell.language.chinese' },
  { code: 'es', labelKey: 'shell.language.spanish' },
  { code: 'fr', labelKey: 'shell.language.french' },
  { code: 'de', labelKey: 'shell.language.german' },
]

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
  labelKey: string
  titleKey: string
  icon: React.ReactNode
}> = [
  {
    value: 'light',
    labelKey: 'shell.theme.light',
    titleKey: 'shell.theme.lightTitle',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="2.4" />
        <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1 1M10.4 10.4l1 1M2.6 11.4l1-1M10.4 3.6l1-1" />
      </svg>
    ),
  },
  {
    value: 'dark',
    labelKey: 'shell.theme.dark',
    titleKey: 'shell.theme.darkTitle',
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
  const { t } = useTranslation()
  return (
    <div className="v4p-theme-toggle" role="group" aria-label={t('shell.theme.aria')}>
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`v4p-theme-btn ${theme === option.value ? 'on' : ''}`}
          onClick={() => onSelect(option.value)}
          title={t(option.titleKey)}
          aria-pressed={theme === option.value}
          aria-label={t(option.labelKey)}
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

function getNextShelf(current: Shelf): Shelf {
  if (current === 'closed') return 'whiteboard'
  if (current === 'whiteboard') return 'actions'
  if (current === 'actions') return 'coach'
  return 'closed'
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
  const { t } = useTranslation()
  const cls =
    status === 'connected'
      ? 'cc-pipeline-stage ok'
      : status === 'degraded'
        ? 'cc-pipeline-stage warn'
        : 'cc-pipeline-stage idle'
  const note = message ?? (status === 'connected' ? t('shell.pipeline.ok') : t(`shell.pipeline.${status}`))
  return (
    <span className={cls} title={t('shell.pipeline.stageTitle', { name, status: message ?? status })}>
      <span className="cc-pipeline-dot" />
      <span className="cc-pipeline-name">{name}</span>
      <span className="cc-pipeline-note">{note}</span>
    </span>
  )
}

function App() {
  const { t } = useTranslation()
  const shellRef = useRef<HTMLElement | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [canvasResetVersion, setCanvasResetVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [activeAudioMs, setActiveAudioMs] = useState(0)
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null)
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [whiteboardConnected, setWhiteboardConnected] = useState(false)
  const clockMs = useClockMs()
  const { isFullscreen, toggleFullscreen } = useFullscreenState(shellRef)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [sttLanguage, setSttLanguage] = useState(DEFAULT_STT_LANGUAGE)
  const [translationTarget, setTranslationTarget] = useState(getInitialTranslationTarget)
  const [languageLock, setLanguageLock] = useState<string | null>(null)
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  const {
    shelf,
    setShelf,
    whiteboardMaximized,
    setWhiteboardMaximized,
    memoryLibraryOpen,
    setMemoryLibraryOpen,
    glossaryOpen,
    setGlossaryOpen,
    slackSettingsOpen,
    setSlackSettingsOpen,
  } = usePanels()
  const glossarySuggestionCount = useGlossarySuggestionCount()
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
  const captionTimerRef = useRef<number | null>(null)

  // Stable service instances — same lifecycle pattern as autopreso
  const bus = useMemo(() => new TranscriptBus(), [])
  const capture = useMemo(() => new SystemAudioCaptureService(), [])
  const sttClient = useMemo(
    () => (isElectron ? new ElectronSttClient(bus) : new RealtimeSttClient(bus)),
    [bus]
  )
  const { updateHealth, healthSnapshot } = usePipelineHealth()

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

  const { enColRef, koColRef } = useTranscriptScrollSync({
    items,
    currentPartial,
    syncKey: translationTarget,
  })

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

  const snapshot = {
    ...healthSnapshot,
    translation: {
      ...healthSnapshot.translation,
      status: translationTarget === 'off' ? 'disconnected' : 'connected',
      message:
        translationTarget === 'off'
          ? t('shell.health.notConnected')
          : t('shell.health.toLanguage', { language: translationTarget }),
    },
  } as const

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
  const beginListeningSession = useCallback(async (options: { startCapture: boolean }) => {
    if (running || starting) return
    setError(null)
    setStarting(true)

    try {
      // 1. Connect to transcription proxy
      updateHealth('stt', 'degraded', t('shell.health.connecting'))
      await sttClient.connect(sttLanguage)
      updateHealth('stt', 'connected', t('shell.health.realtimeReady', { language: sttLanguage }))

      // 2. Start system audio capture, or reuse the stream held by Slack Arm.
      if (options.startCapture) {
        updateHealth('capture', 'degraded', t('shell.health.requestingDisplayMedia'))
        await capture.start()
      }
      updateHealth('capture', 'connected', t('shell.health.systemAudioActive'))
      if (sessionStartMs === null) setSessionStartMs(Date.now())
      setRunStartMs(Date.now())

      // 3. Expose analyser for waveform visualization (autopreso pattern)
      setAnalyser(capture.analyser ?? null)

      setRunning(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      updateHealth('stt', 'disconnected', msg)
      updateHealth('capture', 'disconnected', t('shell.health.notStarted'))
    } finally {
      setStarting(false)
    }
  }, [capture, running, sessionStartMs, starting, sttClient, sttLanguage, t, updateHealth])

  const onStart = useCallback(async () => {
    await beginListeningSession({ startCapture: true })
  }, [beginListeningSession])

  /**
   * Stop listening — mirrors autopreso/public/app.js stopListening().
   */
  const endListeningSession = useCallback((options: { stopCapture: boolean }) => {
    if (runStartMs !== null) {
      const startedAt = runStartMs
      setActiveAudioMs((ms) => ms + (Date.now() - startedAt))
      setRunStartMs(null)
    }
    if (options.stopCapture) {
      capture.stop()
    }
    sttClient.disconnect()
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current)
      captionTimerRef.current = null
    }
    setCaptionText('')
    setAnalyser(null)
    if (options.stopCapture) {
      updateHealth('capture', 'disconnected', t('shell.health.stopped'))
    }
    updateHealth('stt', 'disconnected', t('shell.health.stopped'))
    setRunning(false)
  }, [capture, runStartMs, sttClient, t, updateHealth])

  const beginSlackHuddleSession = useCallback(
    () => beginListeningSession({ startCapture: false }),
    [beginListeningSession]
  )

  const endSlackHuddleSession = useCallback(() => {
    endListeningSession({ stopCapture: false })
  }, [endListeningSession])

  const slackArm = useSlackArm({
    enabled: isElectron,
    capture,
    sessionActive: running,
    beginSession: beginSlackHuddleSession,
    endSession: endSlackHuddleSession,
    onError: setError,
  })

  const onStop = useCallback(() => {
    endListeningSession({ stopCapture: true })
    if (slackArm.armed) {
      void slackArm.disarm()
    }
  }, [endListeningSession, slackArm])

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
    updateHealth('capture', 'disconnected', t('shell.health.sessionReset'))
    updateHealth('stt', 'disconnected', t('shell.health.sessionReset'))
    // translation health is config-driven; let the translationTarget effect manage it

    const ws = whiteboardWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'whiteboard:reset' }))
    }
  }, [clear, onStop, resetActionItems, resetConfirming, running, setWhiteboardMaximized, t, updateHealth])

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

  useAnswerAssistHotkey(triggerAnswerAssist)

  const handleSendAskToMindMap = useCallback(async (payload: AskMindMapPayload): Promise<void> => {
    const api = window.electronAPI?.whiteboard
    if (!api?.createMindMapFromAsk) {
      throw new Error(t('shell.errors.mindMapDesktopOnly'))
    }
    await api.createMindMapFromAsk(payload)
    setShelf('whiteboard')
    setWhiteboardMaximized(true)
  }, [setShelf, setWhiteboardMaximized, t])

  const toggleShelf = useCallback(() => {
    setShelf((current) => getNextShelf(current))
  }, [setShelf])

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
  const languageLabelByCode = useMemo(
    () => new Map(LANGUAGE_OPTIONS.map((language) => [language.code, t(language.labelKey)])),
    [t]
  )

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
              {running ? t('shell.status.live') : starting ? t('shell.status.starting') : t('shell.status.idle')}
            </span>
            <span className="v4p-live-time amw-mono">{heroDurationLabel}</span>
          </span>
          <div className="cc-pipeline" role="group" aria-label={t('shell.pipeline.aria')}>
            <PipelineStage
              name={t('shell.pipeline.capture')}
              status={snapshot.capture.status}
              message={snapshot.capture.message}
            />
            <PipelineStage
              name={t('shell.pipeline.stt')}
              status={snapshot.stt.status}
              message={snapshot.stt.message}
            />
            <PipelineStage
              name={t('shell.pipeline.translate')}
              status={snapshot.translation.status}
              message={snapshot.translation.message}
            />
            <PipelineStage
              name={t('shell.pipeline.agent')}
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
                  ? t('shell.pipeline.generating')
                  : agentStatus === 'error'
                    ? t('shell.pipeline.error')
                    : whiteboardConnected
                      ? t('shell.pipeline.ready')
                      : t('shell.pipeline.idle')
              }
            />
          </div>
        </div>

        <div className="v4p-head-mid">
          <span className="v4p-eyebrowtxt">{t('shell.header.session')}</span>
          <h1 className="v4p-title">AutoMeetic</h1>
        </div>

        <div className="v4p-head-right">
          <LanguagePicker />
          <ThemeToggle theme={theme} onSelect={setTheme} />
          <div className="v4p-lang">
            <select
              className="v4p-lang-select"
              value={sttLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              disabled={running || starting}
              aria-label={t('shell.language.inputAria')}
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code === 'auto' ? t('shell.language.auto') : language.code.toUpperCase()}
                </option>
              ))}
            </select>
            <em>→</em>
            <select
              className="v4p-lang-select"
              value={translationTarget}
              onChange={(event) => onTranslationChange(event.target.value)}
              aria-label={t('shell.language.translationTargetAria')}
            >
              <option value="off">{t('shell.language.off')}</option>
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
            title={running ? t('shell.record.stopTitle') : t('shell.record.startTitle')}
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
              {running ? t('shell.record.stop') : starting ? t('shell.record.starting') : t('shell.record.start')}
            </span>
          </button>

          {isElectron ? (
            <div className="v4p-slack-arm" data-state={slackArm.status.state}>
              <button
                className={`v4p-iconbtn ${slackArm.armed ? 'on' : ''}`}
                type="button"
                onClick={() => {
                  if (slackArm.armed) void slackArm.disarm()
                  else void slackArm.arm()
                }}
                disabled={starting}
                title={slackArm.armed ? t('slack.arm.disarmTitle') : t('slack.arm.armTitle')}
                aria-label={slackArm.armed ? t('slack.arm.disarmAria') : t('slack.arm.armAria')}
                aria-pressed={slackArm.armed}
              >
                <span aria-hidden="true">S</span>
              </button>
              <span className="v4p-slack-arm-status">
                {t(`slack.status.${slackArm.status.state}`)}
              </span>
            </div>
          ) : null}

          <button
            className={`v4p-iconbtn ghost ${shelf !== 'closed' ? 'on' : ''}`}
            type="button"
            onClick={toggleShelf}
            title={shelf === 'closed' ? t('shell.panel.show') : t('shell.panel.hide')}
            aria-label={t('shell.panel.toggleAria')}
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
            title={t('shell.library.title')}
            aria-label={t('shell.library.title')}
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
            title={t('shell.glossary.title')}
            aria-label={t('shell.glossary.title')}
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

          {isElectron ? (
            <button
              className={`v4p-iconbtn ghost ${slackSettingsOpen ? 'on' : ''}`}
              type="button"
              onClick={() => setSlackSettingsOpen(true)}
              title={t('slack.settings.title')}
              aria-label={t('slack.settings.title')}
              aria-pressed={slackSettingsOpen}
            >
              <span aria-hidden="true">S</span>
            </button>
          ) : null}

          <button
            className="v4p-iconbtn ghost"
            type="button"
            onClick={() => {
              void toggleFullscreen()
            }}
            title={isFullscreen ? t('shell.fullscreen.exit') : t('shell.fullscreen.enter')}
            aria-label={t('shell.fullscreen.toggleAria')}
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
            title={t('shell.answerAssist.title')}
            aria-label={t('shell.answerAssist.aria')}
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
        <TranscriptColumns
          items={items}
          hasFeedContent={hasFeedContent}
          showTranslationColumn={showTranslationColumn}
          sourceLang={sourceLang}
          targetLang={targetLang}
          languageLock={languageLock}
          detectedLanguage={detectedLanguage}
          sessionStartMs={sessionStartMs}
          enColRef={enColRef}
          koColRef={koColRef}
          langCode={langCode}
          formatDuration={formatDuration}
          languageLabelByCode={languageLabelByCode}
        />

        {/* Right shelf */}
        <RightShelf
          shelf={shelf}
          whiteboardElements={whiteboardElements}
          actionItemList={actionItemList}
          canvasResetVersion={canvasResetVersion}
          viewportCommand={viewportCommand}
          agentStatus={agentStatus}
          onShelfChange={setShelf}
          onWhiteboardMaximize={() => setWhiteboardMaximized(true)}
          onAcceptActionItem={acceptActionItem}
          onDismissActionItem={dismissActionItem}
          onDoneActionItem={markActionItemDone}
          onUpdateActionItem={updateActionItem}
          onOpenCluster={() => setMemoryLibraryOpen(true)}
        />
      </div>

      {/* ── Broadcast lower-third console ─────────────────────── */}
      <footer className={`cc-console ${running ? 'live' : ''}`}>
        <div className="cc-console-meta">
          <div className="cc-console-line">
            {running && <span className="cc-console-pulse" aria-hidden="true" />}
            <span className="cc-console-label">
              {running ? t('feed.console.nowSpeaking') : t('feed.console.lastCaption')}
            </span>
            <span className="cc-console-sep">·</span>
            <span className="cc-console-source">{t('feed.console.systemAudio')}</span>
            <span className="cc-console-sep">·</span>
            <span className="amw-mono cc-console-time">{heroDurationLabel}</span>
          </div>
          <div className="cc-console-stats">
            <span>
              <strong className="amw-mono">{transcriptCount}</strong> {t('feed.console.captions')}
            </span>
            <span className="cc-console-sep">·</span>
            <span>
              <strong className="amw-mono">{sourceWordCount}</strong> {t('feed.console.words')}
            </span>
          </div>
        </div>

        <div className="cc-console-cap">
          <div className="cc-console-cap-src">
            {heroSourceText || (
              <span className="cc-console-cap-placeholder">
                {running
                  ? t('feed.console.listening')
                  : t('feed.console.startHint')}
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
            <span>{answerBusy ? t('feed.console.thinking') : t('feed.console.ask')}</span>
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

      <AppModals
        whiteboardMaximized={whiteboardMaximized}
        whiteboardElements={whiteboardElements}
        viewportCommand={viewportCommand}
        agentStatus={agentStatus}
        canvasResetVersion={canvasResetVersion}
        onWhiteboardElementsChange={handleWhiteboardChange}
        onWhiteboardScreenshot={handleWhiteboardScreenshot}
        onWhiteboardClose={() => setWhiteboardMaximized(false)}
        memoryLibraryOpen={memoryLibraryOpen}
        onMemoryLibraryClose={() => setMemoryLibraryOpen(false)}
        onSendAskToMindMap={handleSendAskToMindMap}
        slackSettingsOpen={slackSettingsOpen}
        onSlackSettingsClose={() => setSlackSettingsOpen(false)}
        glossaryOpen={glossaryOpen}
        onGlossaryClose={() => setGlossaryOpen(false)}
      />
    </main>
  )
}

export default App
