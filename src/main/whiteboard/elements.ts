import type { WhiteboardElement } from "./types";

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const CHAR_WIDTH_RATIO = 0.6;
const PADDING_PER_SIDE = 28;
const MIN_SHAPE_GAP = 56;
const ARROW_LABEL_PADDING = 12;

/**
 * Normalize whiteboard elements (strip Excalidraw internals).
 * From autopreso: whiteboard-elements.js
 */
export function normalizeWhiteboardElements(elements: unknown): WhiteboardElement[] {
  if (!Array.isArray(elements)) return [];
  const byId = new Map<string, WhiteboardElement>();
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const candidate = element as WhiteboardElement;
    if (typeof candidate.id !== "string") continue;
    byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
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
  const arrows = elements.filter((el) => el?.type === "arrow");

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

  for (const shape of shapes) {
    const labelText = shape?.label?.text;
    if (typeof labelText !== "string" || labelText.length === 0) continue;
    const estimated = estimateTextBox(labelText, shape.label?.fontSize);
    const minWidth = estimated.width + PADDING_PER_SIDE * 2;
    const minHeight = estimated.height + PADDING_PER_SIDE * 2;
    if (typeof shape.width === "number" && shape.width < minWidth) {
      warnings.push(
        `Shape "${shape.id}" is too narrow for label "${labelText.slice(0, 40)}"; widen it or shorten the label.`
      );
    }
    if (typeof shape.height === "number" && shape.height < minHeight) {
      warnings.push(
        `Shape "${shape.id}" is too short for label "${labelText.slice(0, 40)}"; grow it or shorten the label.`
      );
    }
  }

  for (let i = 0; i < shapes.length; i += 1) {
    const a = shapes[i];
    if (!hasRect(a)) continue;
    for (let j = i + 1; j < shapes.length; j += 1) {
      const b = shapes[j];
      if (!hasRect(b)) continue;
      if (rectanglesOverlap(a, b)) {
        warnings.push(
          `Shapes "${a.id}" and "${b.id}" overlap. Rebuild the diagram with fewer nodes, larger gaps, or a simpler layout.`
        );
        continue;
      }
      if (rectanglesGap(a, b) < MIN_SHAPE_GAP) {
        warnings.push(
          `Shapes "${a.id}" and "${b.id}" are too close. Keep at least ${MIN_SHAPE_GAP}px of whitespace so labels and arrows stay readable.`
        );
      }
    }
  }

  for (const arrow of arrows) {
    const arrowLine = getArrowLine(arrow);
    if (!arrowLine) continue;

    for (const shape of shapes) {
      if (lineIntersectsInterior(arrowLine, shape)) {
        warnings.push(
          `Arrow "${arrow.id}" crosses through shape "${shape.id}". Move the connected nodes so the arrow sits in the gap between adjacent shapes.`
        );
        break;
      }
    }

    const labelText = arrow?.label?.text;
    if (typeof labelText !== "string" || !labelText.trim()) continue;
    const labelBox = estimateArrowLabelBox(arrow, arrowLine);
    if (!labelBox) continue;
    for (const shape of shapes) {
      if (
        typeof shape.x !== "number" ||
        typeof shape.y !== "number" ||
        typeof shape.width !== "number" ||
        typeof shape.height !== "number"
      ) {
        continue;
      }
      if (
        !rectanglesOverlap(labelBox, {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
        })
      ) {
        continue;
      }
      warnings.push(
        `Arrow label "${labelText.slice(0, 40)}" on arrow "${arrow.id}" overlaps shape "${shape.id}". Move the arrow or shorten/remove the label.`
      );
      break;
    }
  }

  return warnings;
}

function hasRect(
  element: WhiteboardElement
): element is WhiteboardElement & { x: number; y: number; width: number; height: number } {
  return (
    typeof element?.x === "number" &&
    typeof element?.y === "number" &&
    typeof element?.width === "number" &&
    typeof element?.height === "number"
  );
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectanglesGap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const horizontalGap = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const verticalGap = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  if (horizontalGap === 0) return verticalGap;
  if (verticalGap === 0) return horizontalGap;
  return Math.hypot(horizontalGap, verticalGap);
}

function getArrowLine(arrow: WhiteboardElement): { x1: number; y1: number; x2: number; y2: number } | null {
  if (typeof arrow.x !== "number" || typeof arrow.y !== "number") return null;
  const points = Array.isArray(arrow.points) ? arrow.points : null;
  const first = points?.[0];
  const last = points?.[points.length - 1];
  if (
    Array.isArray(first) &&
    Array.isArray(last) &&
    typeof first[0] === "number" &&
    typeof first[1] === "number" &&
    typeof last[0] === "number" &&
    typeof last[1] === "number"
  ) {
    return {
      x1: arrow.x + first[0],
      y1: arrow.y + first[1],
      x2: arrow.x + last[0],
      y2: arrow.y + last[1],
    };
  }
  if (typeof arrow.width === "number" && typeof arrow.height === "number") {
    return {
      x1: arrow.x,
      y1: arrow.y,
      x2: arrow.x + arrow.width,
      y2: arrow.y + arrow.height,
    };
  }
  return null;
}

function lineIntersectsInterior(
  line: { x1: number; y1: number; x2: number; y2: number },
  shape: WhiteboardElement
): boolean {
  if (
    typeof shape.x !== "number" ||
    typeof shape.y !== "number" ||
    typeof shape.width !== "number" ||
    typeof shape.height !== "number"
  ) {
    return false;
  }
  const inset = 10;
  const rect = {
    x: shape.x + inset,
    y: shape.y + inset,
    width: Math.max(shape.width - inset * 2, 0),
    height: Math.max(shape.height - inset * 2, 0),
  };
  if (pointInsideRect(line.x1, line.y1, rect) || pointInsideRect(line.x2, line.y2, rect)) {
    return true;
  }
  return (
    segmentsIntersect(line.x1, line.y1, line.x2, line.y2, rect.x, rect.y, rect.x + rect.width, rect.y) ||
    segmentsIntersect(line.x1, line.y1, line.x2, line.y2, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height) ||
    segmentsIntersect(line.x1, line.y1, line.x2, line.y2, rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height) ||
    segmentsIntersect(line.x1, line.y1, line.x2, line.y2, rect.x, rect.y + rect.height, rect.x, rect.y)
  );
}

function estimateArrowLabelBox(
  arrow: WhiteboardElement,
  line: { x1: number; y1: number; x2: number; y2: number }
): { x: number; y: number; width: number; height: number } | null {
  const labelText = arrow?.label?.text;
  if (typeof labelText !== "string") return null;
  const estimated = estimateTextBox(labelText, arrow.label?.fontSize ?? 14);
  const centerX = (line.x1 + line.x2) / 2;
  const centerY = (line.y1 + line.y2) / 2;
  return {
    x: centerX - estimated.width / 2 - ARROW_LABEL_PADDING,
    y: centerY - estimated.height / 2 - ARROW_LABEL_PADDING,
    width: estimated.width + ARROW_LABEL_PADDING * 2,
    height: estimated.height + ARROW_LABEL_PADDING * 2,
  };
}

function pointInsideRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4;
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
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
