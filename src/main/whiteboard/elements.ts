import type { WhiteboardElement } from "./types";

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const CHAR_WIDTH_RATIO = 0.6;

/**
 * Normalize whiteboard elements (strip Excalidraw internals).
 * From autopreso: whiteboard-elements.js
 */
export function normalizeWhiteboardElements(elements: unknown): WhiteboardElement[] {
  if (!Array.isArray(elements)) return [];
  return elements as WhiteboardElement[];
}

/**
 * Detect layout warnings (e.g., overlapping text and shapes).
 * From autopreso: whiteboard-elements.js
 */
export function detectMalformedLayoutWarnings(elements: WhiteboardElement[]): string[] {
  if (!Array.isArray(elements) || elements.length === 0) return [];

  const warnings: string[] = [];
  const shapes = elements.filter((el) => SHAPE_TYPES.has(el?.type));
  const texts = elements.filter((el) => el?.type === "text");

  // Standalone text overlapping a shape -> should have been a label.
  for (const text of texts) {
    if (typeof text.x !== "number" || typeof text.y !== "number") continue;
    const estimated = estimateTextBox(text.text, text.fontSize);
    const textBox = {
      x: text.x,
      y: text.y,
      width: typeof text.width === "number" ? text.width : estimated.width,
      height: typeof text.height === "number" ? text.height : estimated.height,
    };
    for (const shape of shapes) {
      if (typeof shape.width !== "number" || typeof shape.height !== "number") continue;
      if (rectanglesOverlap(textBox, { x: shape.x, y: shape.y, width: shape.width, height: shape.height })) {
        warnings.push(
          `Text element "${text.text}" (${text.id}) overlaps shape "${shape.label?.text || shape.id}". Either move the text or use a label inside the shape.`
        );
      }
    }
  }

  return warnings;
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function estimateTextBox(text: string | undefined, fontSize: number | undefined): { width: number; height: number } {
  const fs = fontSize ?? 18;
  const lines = String(text ?? "").split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    width: Math.ceil(longest * fs * CHAR_WIDTH_RATIO),
    height: Math.ceil(lines.length * fs * 1.25),
  };
}

/**
 * Append layout warnings to the formatted whiteboard output.
 */
export function appendLayoutWarnings(formatted: string, elements: WhiteboardElement[]): string {
  const warnings = detectMalformedLayoutWarnings(elements);
  if (warnings.length === 0) return formatted;

  return (
    formatted +
    "\n\nLayout warnings:\n" +
    warnings.map((w) => `  ⚠ ${w}`).join("\n")
  );
}
