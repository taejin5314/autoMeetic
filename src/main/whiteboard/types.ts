/**
 * Whiteboard drawing object types (from autopreso)
 * Simple JSON serializable format, not tied to Excalidraw internals.
 */

export type ShapeType = "rectangle" | "ellipse" | "diamond" | "arrow" | "text";

export interface Label {
  text: string;
  fontSize?: number;
}

export interface Roundness {
  type: number;
}

/**
 * Simple drawing object that the agent produces.
 * The frontend converts these to Excalidraw elements.
 */
export interface WhiteboardElement {
  type: ShapeType;
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  label?: Label;
  backgroundColor?: string;
  fillStyle?: string;
  roundness?: Roundness;
  // Arrow-specific
  points?: Array<[number, number]>;
  // For arrows
  startArrowType?: string;
  endArrowType?: string;
}

/**
 * Edit operation emitted by the agent
 */
export type EditOperation =
  | { type: "replace"; line: number; element: WhiteboardElement }
  | { type: "insert_after"; line: number; element: WhiteboardElement }
  | { type: "delete"; line: number };

/**
 * Viewport command emitted by the agent
 */
export interface ViewportCommand {
  action: "scroll_to_content" | "set_zoom" | "zoom_in" | "zoom_out" | "reset_zoom";
  zoom?: number;
  focus_ids?: string[];
}

/**
 * Whiteboard session state (from autopreso)
 */
export interface WhiteboardSession {
  mode: "staging" | "live";
  elements: WhiteboardElement[];
  agentHistory: Array<{ role: string; content: string }>;
  agentStatus: "idle" | "thinking" | "done";
  agentBusy: boolean;
  warmupBusy: boolean;
  latestScreenshot?: string;
  agentInstructions: string;
  warmupState: {
    state: "idle" | "running" | "done" | "error";
    attempt: number;
    maxAttempts: number;
  };
  canvasDirtyForAgent: boolean;
}

/**
 * Agent event for tracking execution
 */
export type AgentEvent =
  | { type: "warmup:start"; attempt: number; system: string; timestamp: string }
  | { type: "warmup:done"; attempt: number; timestamp: string }
  | { type: "tool:start"; tool: string; input: unknown; timestamp: string }
  | { type: "tool:end"; tool: string; result: string; elements: WhiteboardElement[]; timestamp: string }
  | { type: "agent:thinking"; timestamp: string }
  | { type: "agent:done"; timestamp: string };

export type WhiteboardMode = 'freeform' | 'mindmap'

export interface MindMapNode {
  id: string
  parentId: string | null
  label: string
  depth: number
}

export interface MindMapState {
  rootId: string
  nodes: MindMapNode[]
  topicSource: 'meeting-title' | 'llm-detected'
}

export type MindMapOperation =
  | { type: 'add_branch'; parentLabel: string; label: string }
  | { type: 'upgrade_root'; newLabel: string }
