/**
 * Excalidraw-backed whiteboard canvas.
 * Ported from autopreso/public/app.js Excalidraw integration (MIT License).
 *
 * The agent works with simple JSON drawing objects (WhiteboardElement).
 * This component converts them into Excalidraw-native elements for rendering,
 * and converts user edits back into the simple format for the agent.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { WhiteboardElement, ViewportCommand } from "../../main/whiteboard/types";

// Excalidraw types — use inline types to avoid deep import path issues
interface ExcalidrawImperativeAPI {
  updateScene: (opts: Record<string, unknown>) => void;
  getSceneElements: () => readonly ExcalidrawElement[];
  getAppState: () => { zoom?: { value?: number } } & Record<string, unknown>;
  scrollToContent: (elements?: readonly ExcalidrawElement[] | undefined, opts?: Record<string, unknown>) => void;
}

interface ExcalidrawElement {
  id: string;
  type: string;
  [key: string]: unknown;
}

// ── Excalidraw internal fields we strip when syncing back to the agent ──────
const INTERNAL_FIELDS = new Set([
  "versionNonce",
  "version",
  "updated",
  "seed",
  "index",
  "link",
  "locked",
  "customData",
  "frameId",
  "groupIds",
  "boundElements",
  "containerId",
  "isDeleted",
]);

interface ExcalidrawCanvasProps {
  /** Elements from agent (WhiteboardElement format) */
  elements: WhiteboardElement[];
  /** Callback when user edits on the canvas */
  onElementsChange?: (elements: WhiteboardElement[]) => void;
  /** Viewport commands from agent */
  viewportCommand?: ViewportCommand | null;
  /** Whether to show in view-only mode */
  viewModeEnabled?: boolean;
  /** Callback to expose the API ref upward */
  onApiReady?: (api: ExcalidrawImperativeAPI) => void;
}

/**
 * Convert our simple WhiteboardElement to Excalidraw-compatible element.
 * Ported from autopreso: the agent produces simple objects and the frontend
 * converts them to the full Excalidraw element shape.
 */
function toExcalidrawElement(el: WhiteboardElement): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width ?? 0,
    height: el.height ?? 0,
    strokeColor: "#1e1e1e",
    backgroundColor: el.backgroundColor ?? "transparent",
    fillStyle: el.fillStyle ?? "solid",
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
  };

  if (el.roundness) {
    base.roundness = el.roundness;
  }

  if (el.type === "text") {
    base.text = el.text ?? "";
    base.fontSize = el.fontSize ?? 18;
    base.fontFamily = 3; // Cascadia
    base.textAlign = "left";
    base.verticalAlign = "top";
    base.containerId = null;
    // Estimate width/height for text
    if (!el.width) {
      const lines = (el.text ?? "").split("\n");
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
      const fontSize = el.fontSize ?? 18;
      base.width = Math.ceil(longest * fontSize * 0.6);
      base.height = Math.ceil(lines.length * fontSize * 1.35);
    }
  }

  if (el.label) {
    // Excalidraw uses bound text elements for labels
    // We'll handle this through updateScene
  }

  if (el.type === "arrow") {
    base.points = el.points ?? [[0, 0], [el.width ?? 100, el.height ?? 0]];
    base.startBinding = null;
    base.endBinding = null;
    base.startArrowhead = null;
    base.endArrowhead = "arrow";
    base.lastCommittedPoint = null;
  }

  return base;
}

/**
 * Build renderable elements including bound text for labels.
 * Ported from autopreso: labels become bound text elements.
 */
function buildRenderableElements(elements: WhiteboardElement[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const el of elements) {
    const excalidrawEl = toExcalidrawElement(el);

    if (el.label && el.type !== "text") {
      // Create a bound text element for the label
      const textId = `${el.id}-label`;
      excalidrawEl.boundElements = [{ id: textId, type: "text" }];

      result.push(excalidrawEl);

      // Add the bound text element
      const fontSize = el.label.fontSize ?? 16;
      const lines = el.label.text.split("\n");
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);

      result.push({
        id: textId,
        type: "text",
        x: el.x + (el.width ?? 0) / 2,
        y: el.y + (el.height ?? 0) / 2,
        width: Math.ceil(longest * fontSize * 0.6),
        height: Math.ceil(lines.length * fontSize * 1.35),
        text: el.label.text,
        fontSize,
        fontFamily: 3,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: el.id,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
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
      });
    } else {
      result.push(excalidrawEl);
    }
  }

  return result;
}

/**
 * Strip Excalidraw internals from native elements and convert back to
 * our simple WhiteboardElement format.
 * Ported from autopreso/public/app.js nativeElementsToSkeletonForSync()
 */
function toWhiteboardElements(nativeElements: readonly ExcalidrawElement[]): WhiteboardElement[] {
  const result: WhiteboardElement[] = [];
  const boundTextIds = new Set<string>();

  // First pass: identify bound text elements (they are labels)
  for (const el of nativeElements) {
    if ((el as Record<string, unknown>).containerId) {
      boundTextIds.add(el.id);
    }
  }

  for (const el of nativeElements) {
    if ((el as Record<string, unknown>).isDeleted) continue;
    if (boundTextIds.has(el.id)) continue; // Skip bound text, fold into parent

    const raw = el as unknown as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (!INTERNAL_FIELDS.has(key)) {
        cleaned[key] = value;
      }
    }

    // Find any bound text and fold it back as a label
    const boundElements = raw.boundElements as Array<{ id: string; type: string }> | null;
    if (Array.isArray(boundElements)) {
      for (const bound of boundElements) {
        if (bound.type === "text") {
          const textEl = nativeElements.find((e) => e.id === bound.id);
          if (textEl) {
            const textRaw = textEl as unknown as Record<string, unknown>;
            cleaned.label = {
              text: textRaw.text as string,
              fontSize: textRaw.fontSize as number,
            };
          }
        }
      }
    }

    // Strip boundElements from output
    delete cleaned.boundElements;

    result.push(cleaned as unknown as WhiteboardElement);
  }

  return result;
}

export const ExcalidrawCanvas: React.FC<ExcalidrawCanvasProps> = ({
  elements,
  onElementsChange,
  viewportCommand,
  viewModeEnabled = false,
  onApiReady,
}) => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSyncedHashRef = useRef<string>("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setApi = useCallback(
    (api: ExcalidrawImperativeAPI | null) => {
      if (!api) return;
      apiRef.current = api;
      onApiReady?.(api);
    },
    [onApiReady]
  );

  // ── Sync agent elements → Excalidraw ──────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const renderable = buildRenderableElements(elements);
    api.updateScene({
      elements: renderable as ExcalidrawElement[],
      appState: { viewBackgroundColor: "#fffdf8" },
    });

    // Fit to content when elements appear for the first time
    if (renderable.length > 0) {
      requestAnimationFrame(() => {
        api.scrollToContent(undefined, { animate: false });
      });
    }
  }, [elements]);

  // ── Handle viewport commands from agent ───────────────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !viewportCommand) return;

    const { action, zoom, focus_ids } = viewportCommand;

    if (action === "scroll_to_content") {
      if (Array.isArray(focus_ids) && focus_ids.length > 0) {
        const scene = api.getSceneElements();
        const matched = scene.filter((el: ExcalidrawElement) => focus_ids.includes(el.id));
        if (matched.length > 0) {
          api.scrollToContent(matched, { animate: true });
        }
      } else {
        api.scrollToContent(undefined, { animate: true });
      }
    }

    if (action === "set_zoom" && typeof zoom === "number") {
      const zoomValue = Math.min(3, Math.max(0.1, zoom));
      api.updateScene({ appState: { zoom: { value: zoomValue } } });
    }

    if (action === "zoom_in") {
      const currentZoom = api.getAppState().zoom?.value ?? 1;
      api.updateScene({ appState: { zoom: { value: Math.min(3, currentZoom * 1.2) } } });
    }

    if (action === "zoom_out") {
      const currentZoom = api.getAppState().zoom?.value ?? 1;
      api.updateScene({ appState: { zoom: { value: Math.max(0.1, currentZoom / 1.2) } } });
    }

    if (action === "reset_zoom") {
      api.updateScene({ appState: { zoom: { value: 1 } } });
    }
  }, [viewportCommand]);

  // ── Debounced change handler (user edits → parent) ────────────────────────
  const handleChange = useCallback(
    (nativeElements: readonly ExcalidrawElement[]) => {
      if (!onElementsChange) return;

      // Hash to prevent redundant updates
      const cleaned = nativeElements.filter(
        (el) => !(el as unknown as Record<string, unknown>).isDeleted
      );
      const hash = JSON.stringify(cleaned.map((el) => el.id).sort());
      if (hash === lastSyncedHashRef.current) return;
      lastSyncedHashRef.current = hash;

      // Debounce to 500ms (autopreso pattern)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        const converted = toWhiteboardElements(nativeElements);
        onElementsChange(converted);
      }, 500);
    },
    [onElementsChange]
  );

  return (
    <div className="excalidraw-wrapper">
      <Excalidraw
        excalidrawAPI={(api) => setApi(api as ExcalidrawImperativeAPI | null)}
        onChange={handleChange}
        viewModeEnabled={viewModeEnabled}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
            saveToActiveFile: false,
          },
        }}
        theme="light"
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
};
