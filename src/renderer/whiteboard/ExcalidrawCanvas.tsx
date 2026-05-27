/**
 * Excalidraw-backed whiteboard canvas.
 * Ported from autopreso/public/app.js Excalidraw integration (MIT License).
 *
 * The agent works with simple JSON drawing objects (WhiteboardElement).
 * This component converts them into Excalidraw-native elements for rendering,
 * and converts user edits back into the simple format for the agent.
 */
import {
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  MainMenu,
} from '@excalidraw/excalidraw'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'
import { repairWhiteboardLayout } from '../../main/whiteboard/elements'
import { useThemeStore, type Theme } from '../theme/useThemeStore'

const WB_LIGHT_BG = '#fafafa'
const WB_DARK_BG = '#101216'
const WB_LIGHT_EXPORT_BG = '#ffffff'
const WB_DARK_EXPORT_BG = '#101216'
const WB_LIGHT_INK = '#1e1e1e'
const WB_DARK_INK = '#f4f4f5'
const WB_DEFAULT_NODE_FILL = '#a5d8ff'
const WB_ACCENT_NODE_FILL = '#ffd6a5'

// Excalidraw types — use inline types to avoid deep import path issues
interface ExcalidrawImperativeAPI {
  updateScene: (opts: Record<string, unknown>) => void
  resetScene: () => void
  getSceneElements: () => readonly ExcalidrawElement[]
  getAppState: () => { zoom?: { value?: number } } & Record<string, unknown>
  scrollToContent: (
    elements?: readonly ExcalidrawElement[] | undefined,
    opts?: Record<string, unknown>
  ) => void
}

interface ExcalidrawElement {
  id: string
  type: string
  [key: string]: unknown
}

// ── Excalidraw internal fields we strip when syncing back to the agent ──────
const INTERNAL_FIELDS = new Set([
  'versionNonce',
  'version',
  'updated',
  'seed',
  'index',
  'link',
  'locked',
  'customData',
  'frameId',
  'groupIds',
  'boundElements',
  'containerId',
  'isDeleted',
])

interface ExcalidrawCanvasProps {
  /** Elements from agent (WhiteboardElement format) */
  elements: WhiteboardElement[]
  /** Callback when user edits on the canvas */
  onElementsChange?: (elements: WhiteboardElement[]) => void
  /** Viewport commands from agent */
  viewportCommand?: ViewportCommand | null
  /** Whether to show in view-only mode */
  viewModeEnabled?: boolean
  /** Callback to expose the API ref upward */
  onApiReady?: (api: ExcalidrawImperativeAPI) => void
  /** Downscaled canvas screenshot for the whiteboard agent */
  onScreenshot?: (dataUrl: string) => void
  /**
   * Compact preview mode: view-only, no chrome, auto-fit to content, and a
   * full-canvas click target that calls onMaximize.
   */
  compact?: boolean
  /** Called when the compact-mode click overlay is clicked. */
  onMaximize?: () => void
}

/**
 * Convert our simple WhiteboardElement to Excalidraw-compatible element.
 * Ported from autopreso: the agent produces simple objects and the frontend
 * converts them to the full Excalidraw element shape.
 */
function isRenderableWhiteboardElement(el: unknown): el is WhiteboardElement {
  if (!el || typeof el !== 'object') return false
  const candidate = el as Partial<WhiteboardElement>
  return typeof candidate.id === 'string' && typeof candidate.type === 'string'
}

function toExcalidrawElement(el: WhiteboardElement, theme: Theme): Record<string, unknown> {
  const strokeColor = theme === 'dark' ? '#f4f4f5' : '#1e1e1e'
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width ?? 0,
    height: el.height ?? 0,
    strokeColor,
    backgroundColor: normalizeShapeFill(el, theme),
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.type === 'arrow' ? 3 : 2,
    roughness: 0.8,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    angle: 0,
  }

  if (el.roundness) {
    base.roundness = el.roundness
  }

  if (el.label) {
    base.label = el.label
  }

  if (el.type === 'text') {
    base.text = el.text ?? ''
    base.fontSize = el.fontSize ?? 18
    base.fontFamily = 3 // Cascadia
    base.textAlign = 'left'
    base.verticalAlign = 'top'
    base.containerId = null
    // Estimate width/height for text
    if (!el.width) {
      const lines = (el.text ?? '').split('\n')
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
      const fontSize = el.fontSize ?? 18
      base.width = Math.ceil(longest * fontSize * 0.6)
      base.height = Math.ceil(lines.length * fontSize * 1.35)
    }
  }

  if (el.type === 'arrow') {
    base.points = el.points ?? [
      [0, 0],
      [el.width ?? 100, el.height ?? 0],
    ]
    base.startBinding = null
    base.endBinding = null
    base.startArrowhead = null
    base.endArrowhead = 'arrow'
    base.lastCommittedPoint = null
  }

  return base
}

/**
 * Build renderable elements using Excalidraw's own converter.
 * This matches autopreso/public/app.js applyScene().
 */
function buildRenderableElements(
  elements: WhiteboardElement[],
  theme: Theme
): Record<string, unknown>[] {
  const repaired = repairWhiteboardLayout(elements)
  const skeleton = repaired
    .filter(isRenderableWhiteboardElement)
    .map((element) => toExcalidrawElement(element, theme))
  const renderable = convertToExcalidrawElements(skeleton as never, {
    regenerateIds: false,
  }) as Record<string, unknown>[]
  return normalizeRenderableColors(renderable, theme)
}

function normalizeRenderableColors(
  renderable: Record<string, unknown>[],
  theme: Theme
): Record<string, unknown>[] {
  const elementTypeById = new Map<string, string>()
  for (const element of renderable) {
    if (typeof element.id === 'string' && typeof element.type === 'string') {
      elementTypeById.set(element.id, element.type)
    }
  }

  return renderable.map((element) => {
    const type = element.type
    const containerId = typeof element.containerId === 'string' ? element.containerId : null
    const containerType = containerId ? elementTypeById.get(containerId) : null
    const next = { ...element }

    if (type === 'arrow') {
      next.strokeColor = theme === 'dark' ? WB_DARK_INK : WB_LIGHT_INK
      next.backgroundColor = 'transparent'
      return next
    }

    if (type === 'text') {
      const textOnCanvas = !containerType || containerType === 'arrow'
      next.strokeColor = theme === 'dark' && textOnCanvas ? WB_DARK_INK : WB_LIGHT_INK
      next.backgroundColor = 'transparent'
      return next
    }

    next.strokeColor = WB_LIGHT_INK
    next.backgroundColor = normalizeRenderableShapeFill(next, theme)
    next.fillStyle = next.fillStyle === 'hachure' ? 'solid' : next.fillStyle
    return next
  })
}

function normalizeShapeFill(el: WhiteboardElement, theme: Theme): string {
  if (el.type === 'arrow' || el.type === 'text') return 'transparent'
  return normalizeFillColor(el.backgroundColor, theme, el.type)
}

function normalizeRenderableShapeFill(element: Record<string, unknown>, theme: Theme): string {
  const type = typeof element.type === 'string' ? element.type : 'rectangle'
  const color = typeof element.backgroundColor === 'string' ? element.backgroundColor : undefined
  return normalizeFillColor(color, theme, type)
}

function normalizeFillColor(color: string | undefined, theme: Theme, type: string): string {
  const fallback = type === 'ellipse' || type === 'diamond' ? WB_ACCENT_NODE_FILL : WB_DEFAULT_NODE_FILL
  if (!color || color === 'transparent') return fallback
  if (theme !== 'dark') return color
  const luminance = getHexLuminance(color)
  if (luminance !== null && luminance < 0.45) return fallback
  return color
}

function getHexLuminance(color: string): number | null {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null
  const raw = match[1]
  const hex =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : raw
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = rgb.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function sceneHash(elements: readonly { id: string }[]): string {
  return JSON.stringify(elements.map((el) => el.id).sort())
}

/**
 * Strip Excalidraw internals from native elements and convert back to
 * our simple WhiteboardElement format.
 * Ported from autopreso/public/app.js nativeElementsToSkeletonForSync()
 */
function toWhiteboardElements(nativeElements: readonly ExcalidrawElement[]): WhiteboardElement[] {
  const result: WhiteboardElement[] = []
  const boundTextIds = new Set<string>()
  const validNativeElements = nativeElements.filter((el): el is ExcalidrawElement =>
    Boolean(el && el.id)
  )

  // First pass: identify bound text elements (they are labels)
  for (const el of validNativeElements) {
    if ((el as Record<string, unknown>).containerId) {
      boundTextIds.add(el.id)
    }
  }

  for (const el of validNativeElements) {
    if ((el as Record<string, unknown>).isDeleted) continue
    if (boundTextIds.has(el.id)) continue // Skip bound text, fold into parent

    const raw = el as unknown as Record<string, unknown>
    const cleaned: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(raw)) {
      if (!INTERNAL_FIELDS.has(key)) {
        cleaned[key] = value
      }
    }

    // Find any bound text and fold it back as a label
    const boundElements = raw.boundElements as Array<{ id: string; type: string }> | null
    if (Array.isArray(boundElements)) {
      for (const bound of boundElements) {
        if (bound.type === 'text') {
          const textEl = validNativeElements.find((e) => e.id === bound.id)
          if (textEl) {
            const textRaw = textEl as unknown as Record<string, unknown>
            cleaned.label = {
              text: textRaw.text as string,
              fontSize: textRaw.fontSize as number,
            }
          }
        }
      }
    }

    // Strip boundElements from output
    delete cleaned.boundElements

    result.push(cleaned as unknown as WhiteboardElement)
  }

  return result
}

export const ExcalidrawCanvas: React.FC<ExcalidrawCanvasProps> = ({
  elements,
  onElementsChange,
  viewportCommand,
  viewModeEnabled = false,
  onApiReady,
  onScreenshot,
  compact = false,
  onMaximize,
}) => {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  // `null` is the "not yet seeded" sentinel. The first onChange that
  // Excalidraw fires after mount is its own echo of the scene we handed
  // it via initialData — NOT a user edit. We record the hash so future
  // identical onChanges (e.g. zoom/pan that doesn't change ids) also get
  // skipped, but we never propagate this first echo upstream. Without this,
  // opening the modal would round-trip the diagram through the agent and
  // could blank the canvas on every mount.
  const lastSyncedHashRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const autoFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressEmptyEchoUntilRef = useRef(0)
  const canvasBg = theme === 'dark' ? WB_DARK_BG : WB_LIGHT_BG
  const exportBg = theme === 'dark' ? WB_DARK_EXPORT_BG : WB_LIGHT_EXPORT_BG

  // Latest elements via ref so the theme-change branch of the
  // initialData memo can read fresh elements without re-running on every
  // element delta.
  const elementsRef = useRef(elements)
  useEffect(() => {
    elementsRef.current = elements
  }, [elements])

  const markProgrammaticSync = useCallback(() => {
    suppressEmptyEchoUntilRef.current = Date.now() + 1000
  }, [])

  const pushElementsToScene = useCallback(
    (api: ExcalidrawImperativeAPI, sourceElements: WhiteboardElement[]): ExcalidrawElement[] => {
      const renderable = buildRenderableElements(sourceElements, theme) as ExcalidrawElement[]
      markProgrammaticSync()
      api.updateScene({
        elements: renderable,
        appState: { viewBackgroundColor: canvasBg, theme: 'light' },
      })
      lastSyncedHashRef.current = sceneHash(renderable)
      return renderable
    },
    [canvasBg, markProgrammaticSync, theme]
  )

  // initialData feeds the inner <Excalidraw> on mount. Later element/theme
  // updates are pushed through updateScene below.
  const initialData = useMemo(
    () => {
      const renderable = elements.length > 0 ? buildRenderableElements(elements, theme) : []
      return {
        elements: renderable as ExcalidrawElement[],
        appState: { viewBackgroundColor: canvasBg, theme: 'light' },
        scrollToContent: renderable.length > 0,
      }
    },
    [canvasBg, elements, theme]
  )

  const setApi = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      if (!api) {
        apiRef.current = null
        return
      }
      apiRef.current = api
      // Belt-and-suspenders: even though we already feed elements through
      // `initialData`, re-push them via `updateScene` once the API is alive.
      // Two reasons:
      //   1. On modal mount, initialData alone sometimes leaves the scene
      //      blank in 0.18 (timing-dependent; suspected resize/observer).
      //   2. Seeding `lastSyncedHashRef` here means the immediate onChange
      //      echo Excalidraw fires has a matching hash and gets skipped
      //      cleanly without going through the null-sentinel branch.
      const current = elementsRef.current
      if (current.length > 0) {
        pushElementsToScene(api, current)
        setTimeout(() => {
          const liveApi = apiRef.current
          if (!liveApi || elementsRef.current.length === 0) return
          pushElementsToScene(liveApi, elementsRef.current)
        }, 75)
        if (!compact) {
          // Give Excalidraw a frame to commit the scene before centring.
          // rAF alone was sometimes too early — the canvas was still 0×0
          // and scrollToContent had nothing to fit to.
          setTimeout(() => {
            const liveApi = apiRef.current
            if (liveApi) liveApi.scrollToContent(undefined, { animate: false })
          }, 50)
        }
      }
      onApiReady?.(api)
    },
    [compact, onApiReady, pushElementsToScene]
  )

  const scheduleScreenshot = useCallback(() => {
    if (!onScreenshot) return
    if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current)
    screenshotTimerRef.current = setTimeout(() => {
      const api = apiRef.current
      if (!api) return
      const sceneElements = api.getSceneElements().filter((el) => !el.isDeleted)
      if (sceneElements.length === 0) return
      void exportToBlob({
        elements: sceneElements,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          viewBackgroundColor: exportBg,
        },
        files: null,
        getDimensions: () => ({ width: 960, height: 540, scale: 0.5 }),
      })
        .then(
          (blob: Blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result ?? ''))
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(blob)
            })
        )
        .then((dataUrl: string) => {
          if (dataUrl) onScreenshot(dataUrl)
        })
        .catch(() => {
          // Screenshot feedback is best-effort; drawing updates should never fail because of it.
        })
    }, 500)
  }, [exportBg, onScreenshot])

  // ── Sync agent elements → Excalidraw ──────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current
    if (!api) return

    if (elements.length === 0) {
      // Don't call resetScene here — it wipes appState back to Excalidraw's
      // built-in defaults (cream viewBackgroundColor), which fights the theme
      // toggle. Update the scene to empty while preserving our background.
      api.updateScene({
        elements: [],
        appState: { viewBackgroundColor: canvasBg, theme: 'light' },
      })
      lastSyncedHashRef.current = ''
      return
    }

    const renderable = pushElementsToScene(api, elements)

    // Full-mode: scroll-to-content only on first appearance.
    // Compact mode handles its own continuous auto-fit via a separate effect.
    // Both `null` (never synced) and `''` (cleared because last update was
    // empty) count as "first appearance".
    if (
      !compact &&
      renderable.length > 0 &&
      (lastSyncedHashRef.current === null || lastSyncedHashRef.current === '')
    ) {
      requestAnimationFrame(() => {
        api.scrollToContent(undefined, { animate: false })
      })
    }
    if (renderable.length > 0) {
      // Mark that we've synced at least once so the first-time fit above
      // doesn't fire again. Use sorted IDs to keep behavior aligned with
      // handleChange's hash dedup.
      lastSyncedHashRef.current = sceneHash(renderable as Array<{ id: string }>)
    }
    scheduleScreenshot()
  }, [canvasBg, compact, elements, pushElementsToScene, scheduleScreenshot, theme])

  useEffect(() => {
    if (elements.length === 0) return
    const api = apiRef.current
    if (!api) return
    const timer = setTimeout(() => {
      const liveApi = apiRef.current
      if (!liveApi || elementsRef.current.length === 0) return
      const liveElements = liveApi.getSceneElements().filter((el) => !el.isDeleted)
      if (liveElements.length > 0) return
      pushElementsToScene(liveApi, elementsRef.current)
      if (compact) {
        liveApi.scrollToContent(undefined, {
          animate: false,
          fitToContent: true,
          viewportZoomFactor: 0.85,
        })
      } else {
        liveApi.scrollToContent(undefined, { animate: false })
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [compact, elements, pushElementsToScene, theme])

  // ── Compact mode: auto-fit on every element change ────────────────────────
  useEffect(() => {
    if (!compact) return
    if (elements.length === 0) return
    const api = apiRef.current
    if (!api) return
    if (autoFitTimerRef.current) clearTimeout(autoFitTimerRef.current)
    autoFitTimerRef.current = setTimeout(() => {
      api.scrollToContent(undefined, {
        animate: false,
        fitToContent: true,
        viewportZoomFactor: 0.85,
      })
    }, 150)
    return () => {
      if (autoFitTimerRef.current) clearTimeout(autoFitTimerRef.current)
    }
  }, [compact, elements])

  // ── Compact mode: re-fit on wrapper resize ────────────────────────────────
  useEffect(() => {
    if (!compact) return
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const api = apiRef.current
      if (!api || elements.length === 0) return
      api.scrollToContent(undefined, {
        animate: false,
        fitToContent: true,
        viewportZoomFactor: 0.85,
      })
    })
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [compact, elements])

  // ── Handle viewport commands from agent ───────────────────────────────────
  useEffect(() => {
    const api = apiRef.current
    if (!api || !viewportCommand) return

    const { action, zoom, focus_ids } = viewportCommand

    if (action === 'scroll_to_content') {
      if (Array.isArray(focus_ids) && focus_ids.length > 0) {
        const scene = api.getSceneElements()
        const matched = scene.filter((el: ExcalidrawElement) => focus_ids.includes(el.id))
        if (matched.length > 0) {
          api.scrollToContent(matched, { animate: true })
        }
      } else {
        api.scrollToContent(undefined, { animate: true })
      }
    }

    if (action === 'set_zoom' && typeof zoom === 'number') {
      const zoomValue = Math.min(3, Math.max(0.1, zoom))
      api.updateScene({ appState: { zoom: { value: zoomValue } } })
    }

    if (action === 'zoom_in') {
      const currentZoom = api.getAppState().zoom?.value ?? 1
      api.updateScene({ appState: { zoom: { value: Math.min(3, currentZoom * 1.2) } } })
    }

    if (action === 'zoom_out') {
      const currentZoom = api.getAppState().zoom?.value ?? 1
      api.updateScene({ appState: { zoom: { value: Math.max(0.1, currentZoom / 1.2) } } })
    }

    if (action === 'reset_zoom') {
      api.updateScene({ appState: { zoom: { value: 1 } } })
    }
    scheduleScreenshot()
  }, [scheduleScreenshot, viewportCommand])

  // ── Debounced change handler (user edits → parent) ────────────────────────
  const handleChange = useCallback(
    (nativeElements: readonly ExcalidrawElement[]) => {
      if (!onElementsChange) return

      const cleaned = nativeElements.filter(
        (el) => !(el as unknown as Record<string, unknown>).isDeleted
      )
      const hash = sceneHash(cleaned)

      if (
        cleaned.length === 0 &&
        elementsRef.current.length > 0 &&
        Date.now() < suppressEmptyEchoUntilRef.current
      ) {
        return
      }

      // First onChange after mount = Excalidraw echoing the scene we just
      // gave it via initialData. Record the hash but DO NOT propagate it
      // upstream — propagating would tell the agent that the user just
      // "edited" the scene to look exactly like it already does, which can
      // race with agent updates and blank the diagram on every modal mount.
      if (lastSyncedHashRef.current === null) {
        lastSyncedHashRef.current = hash
        return
      }

      if (hash === lastSyncedHashRef.current) return
      lastSyncedHashRef.current = hash

      // Debounce to 500ms (autopreso pattern)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        const converted = toWhiteboardElements(nativeElements)
        onElementsChange(converted)
        scheduleScreenshot()
      }, 500)
    },
    [onElementsChange, scheduleScreenshot]
  )

  const isCompact = compact
  const compactUIOptions = {
    canvasActions: {
      loadScene: false,
      export: false as const,
      saveToActiveFile: false,
      toggleTheme: false,
      clearCanvas: false,
      changeViewBackgroundColor: false,
    },
    welcomeScreen: false,
    tools: { image: false },
    dockedSidebarBreakpoint: 0,
  }
  const fullUIOptions = {
    canvasActions: {
      loadScene: false,
      export: false as const,
      saveToActiveFile: false,
    },
  }

  return (
    <div
      className={`excalidraw-wrapper${isCompact ? ' excalidraw-wrapper-compact' : ''}`}
      ref={wrapperRef}
    >
      <Excalidraw
        excalidrawAPI={(api) => setApi(api as ExcalidrawImperativeAPI | null)}
        onChange={isCompact ? undefined : handleChange}
        viewModeEnabled={isCompact ? true : viewModeEnabled}
        UIOptions={isCompact ? compactUIOptions : fullUIOptions}
        theme="light"
        initialData={initialData as never}
      >
        {!isCompact && (
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        )}
      </Excalidraw>
      {isCompact && onMaximize && (
        <button
          type="button"
          className="excal-compact-click"
          onClick={onMaximize}
          aria-label={t('whiteboard.canvas.expand')}
          title={t('whiteboard.canvas.expand')}
        />
      )}
    </div>
  )
}
