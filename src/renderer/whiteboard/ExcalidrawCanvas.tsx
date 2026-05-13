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
import React, { useCallback, useEffect, useRef } from 'react'
import type { ViewportCommand, WhiteboardElement } from '../../main/whiteboard/types'

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

function toExcalidrawElement(el: WhiteboardElement): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width ?? 0,
    height: el.height ?? 0,
    strokeColor: '#1e1e1e',
    backgroundColor: el.backgroundColor ?? 'transparent',
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: 2,
    roughness: 1,
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
function buildRenderableElements(elements: WhiteboardElement[]): Record<string, unknown>[] {
  const skeleton = elements.filter(isRenderableWhiteboardElement).map(toExcalidrawElement)
  return convertToExcalidrawElements(skeleton as never, {
    regenerateIds: false,
  }) as Record<string, unknown>[]
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
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const lastSyncedHashRef = useRef<string>('')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const autoFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setApi = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      if (!api) return
      apiRef.current = api
      onApiReady?.(api)
    },
    [onApiReady]
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
          viewBackgroundColor: '#fffdf8',
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
  }, [onScreenshot])

  // ── Sync agent elements → Excalidraw ──────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current
    if (!api) return

    if (elements.length === 0) {
      api.resetScene()
      lastSyncedHashRef.current = ''
      return
    }

    const renderable = buildRenderableElements(elements)
    api.updateScene({
      elements: renderable as ExcalidrawElement[],
      appState: { viewBackgroundColor: '#fbf8f1' },
    })

    // Full-mode: scroll-to-content only on first appearance.
    // Compact mode handles its own continuous auto-fit via a separate effect.
    if (!compact && renderable.length > 0 && lastSyncedHashRef.current === '') {
      requestAnimationFrame(() => {
        api.scrollToContent(undefined, { animate: false })
      })
    }
    if (renderable.length > 0) {
      // Mark that we've synced at least once so the first-time fit above
      // doesn't fire again. Use sorted IDs to keep behavior aligned with
      // handleChange's hash dedup.
      lastSyncedHashRef.current = JSON.stringify(renderable.map((el) => el.id).sort())
    }
    scheduleScreenshot()
  }, [compact, elements, scheduleScreenshot])

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

      // Hash to prevent redundant updates
      const cleaned = nativeElements.filter(
        (el) => !(el as unknown as Record<string, unknown>).isDeleted
      )
      const hash = JSON.stringify(cleaned.map((el) => el.id).sort())
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
          aria-label="Expand whiteboard"
          title="Expand whiteboard"
        />
      )}
    </div>
  )
}
