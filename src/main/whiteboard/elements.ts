import type { WhiteboardElement } from "./types";

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const CHAR_WIDTH_RATIO = 0.6;
const PADDING_PER_SIDE = 28;
const MIN_SHAPE_GAP = 56;
const ARROW_LABEL_PADDING = 12;
const REPAIR_SHAPE_WIDTH = 260;
const REPAIR_SHAPE_HEIGHT = 90;
const REPAIR_COLUMN_GAP = 140;
const REPAIR_ROW_GAP = 90;
const REPAIR_START_X = 80;
const REPAIR_START_Y = 80;

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
 * Deterministic layout repair for model-generated diagrams.
 *
 * The model is good at choosing concepts, but not reliable at exact geometry.
 * When shapes overlap or crowd, reflow shapes into a simple grid and reroute
 * arrows from shape edge to shape edge. This keeps live diagrams readable
 * without adding another model roundtrip.
 */
export function repairWhiteboardLayout(elements: WhiteboardElement[]): WhiteboardElement[] {
  const normalized = normalizeWhiteboardElements(elements);
  if (normalized.length === 0) return normalized;
  const repairNeeded = needsLayoutRepair(normalized);
  const hasArrows = normalized.some((element) => element.type === "arrow");

  const shapeIds = new Set(
    normalized.filter((element) => SHAPE_TYPES.has(element?.type)).map((element) => element.id)
  );
  const originalShapes = normalized.filter(
    (element): element is WhiteboardElement & { x: number; y: number; width: number; height: number } =>
      SHAPE_TYPES.has(element?.type) && hasRect(element)
  );
  if (originalShapes.length === 0) return normalized;
  if (!repairNeeded && originalShapes.length < 3 && !hasArrows) return normalized;

  const repairedShapeById = new Map<string, WhiteboardElement>();
  const measuredShapes = originalShapes
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(measureShapeForRepair);
  const shouldReflowShapes = repairNeeded || isCompactCrowdedRow(originalShapes);
  const orderedShapes = shouldReflowShapes ? positionMeasuredShapes(measuredShapes) : measuredShapes;

  for (const shape of orderedShapes) {
    repairedShapeById.set(shape.id, shape);
  }

  return normalized
    .filter((element) => {
      if (SHAPE_TYPES.has(element?.type)) return repairedShapeById.has(element.id);
      return true;
    })
    .map((element) => {
      if (repairedShapeById.has(element.id)) return repairedShapeById.get(element.id)!;
      if (element.type === "arrow") {
        return repairArrow(element, originalShapes, repairedShapeById, shouldReflowShapes);
      }
      if (element.type === "text") return repairStandaloneText(element, orderedShapes, shapeIds);
      return element;
    });
}

function needsLayoutRepair(elements: WhiteboardElement[]): boolean {
  return detectMalformedLayoutWarnings(elements).length > 0;
}

function measureShapeForRepair(shape: WhiteboardElement): WhiteboardElement & { width: number; height: number } {
  const estimated = estimateTextBox(shape.label?.text, shape.label?.fontSize);
  const width = Math.max(shape.width ?? 0, REPAIR_SHAPE_WIDTH, estimated.width + PADDING_PER_SIDE * 2);
  const height = Math.max(shape.height ?? 0, REPAIR_SHAPE_HEIGHT, estimated.height + PADDING_PER_SIDE * 2);
  return { ...shape, width, height };
}

function positionMeasuredShapes(
  shapes: Array<WhiteboardElement & { width: number; height: number }>
): Array<WhiteboardElement & { width: number; height: number }> {
  const cols = chooseRepairColumns(shapes.length);
  const colWidths = Array.from({ length: cols }, (_, col) =>
    Math.max(
      ...shapes.filter((_, index) => index % cols === col).map((shape) => shape.width),
      REPAIR_SHAPE_WIDTH
    )
  );
  const rowCount = Math.ceil(shapes.length / cols);
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(
      ...shapes
        .filter((_, index) => Math.floor(index / cols) === row)
        .map((shape) => shape.height),
      REPAIR_SHAPE_HEIGHT
    )
  );

  return shapes.map((shape, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x =
      REPAIR_START_X +
      colWidths.slice(0, col).reduce((sum, width) => sum + width + REPAIR_COLUMN_GAP, 0);
    const y =
      REPAIR_START_Y +
      rowHeights.slice(0, row).reduce((sum, height) => sum + height + REPAIR_ROW_GAP, 0);
    return { ...shape, x, y };
  });
}

function chooseRepairColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return count;
  return 2;
}

function isCompactCrowdedRow(
  shapes: Array<WhiteboardElement & { x: number; y: number; width: number; height: number }>
): boolean {
  if (shapes.length < 3) return false;
  const top = Math.min(...shapes.map((shape) => shape.y));
  const bottom = Math.max(...shapes.map((shape) => shape.y + shape.height));
  const rowHeight = bottom - top;
  const tallest = Math.max(...shapes.map((shape) => shape.height));
  return rowHeight <= tallest * 1.5;
}

function repairArrow(
  arrow: WhiteboardElement,
  originalShapes: Array<WhiteboardElement & { x: number; y: number; width: number; height: number }>,
  repairedShapeById: Map<string, WhiteboardElement>,
  removeLabelsForFullRepair: boolean
): WhiteboardElement {
  const originalLine = getArrowLine(arrow);
  if (!originalLine || originalShapes.length < 2) return arrow;

  const source = nearestShapeToPoint(originalShapes, originalLine.x1, originalLine.y1);
  const target = nearestShapeToPoint(originalShapes, originalLine.x2, originalLine.y2, source?.id);
  if (!source || !target) return arrow;

  const repairedSource = repairedShapeById.get(source.id);
  const repairedTarget = repairedShapeById.get(target.id);
  if (!hasRect(repairedSource) || !hasRect(repairedTarget)) return arrow;

  const line = edgeLineBetween(repairedSource, repairedTarget);
  const repaired: WhiteboardElement = {
    ...arrow,
    x: line.x1,
    y: line.y1,
    width: line.x2 - line.x1,
    height: line.y2 - line.y1,
    points: [
      [0, 0],
      [line.x2 - line.x1, line.y2 - line.y1],
    ],
  };
  if (removeLabelsForFullRepair || arrowLabelOverlapsShape(repaired, repairedShapeById)) {
    return dropArrowLabel(repaired);
  }
  return repaired;
}

function dropArrowLabel(arrow: WhiteboardElement): WhiteboardElement {
  if (!arrow.label) return arrow;
  const repaired = { ...arrow };
  delete repaired.label;
  return repaired;
}

function arrowLabelOverlapsShape(
  arrow: WhiteboardElement,
  shapeById: Map<string, WhiteboardElement>
): boolean {
  const line = getArrowLine(arrow);
  if (!line || !arrow.label?.text) return false;
  const labelBox = estimateArrowLabelBox(arrow, line);
  if (!labelBox) return false;
  for (const shape of shapeById.values()) {
    if (!hasRect(shape)) continue;
    if (rectanglesOverlap(labelBox, shape)) return true;
  }
  return false;
}

function repairStandaloneText(
  text: WhiteboardElement,
  repairedShapes: Array<WhiteboardElement & { width: number; height: number }>,
  shapeIds: Set<string>
): WhiteboardElement {
  if (shapeIds.has(String((text as unknown as Record<string, unknown>).containerId))) return text;
  const estimated = estimateTextBox(text.text, text.fontSize);
  const textBox = {
    x: text.x,
    y: text.y,
    width: text.width ?? estimated.width,
    height: text.height ?? estimated.height,
  };
  if (!repairedShapes.some((shape) => rectanglesOverlap(textBox, shape))) return text;
  const bottom = Math.max(...repairedShapes.map((shape) => shape.y + shape.height));
  return {
    ...text,
    x: REPAIR_START_X,
    y: bottom + REPAIR_ROW_GAP,
  };
}

function nearestShapeToPoint(
  shapes: Array<WhiteboardElement & { x: number; y: number; width: number; height: number }>,
  x: number,
  y: number,
  excludedId?: string
): (WhiteboardElement & { x: number; y: number; width: number; height: number }) | null {
  let best: (WhiteboardElement & { x: number; y: number; width: number; height: number }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const shape of shapes) {
    if (shape.id === excludedId) continue;
    const center = rectCenter(shape);
    const distance = Math.hypot(center.x - x, center.y - y);
    if (distance < bestDistance) {
      best = shape;
      bestDistance = distance;
    }
  }
  return best;
}

function edgeLineBetween(
  source: WhiteboardElement & { x: number; y: number; width: number; height: number },
  target: WhiteboardElement & { x: number; y: number; width: number; height: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const sourceCenter = rectCenter(source);
  const targetCenter = rectCenter(target);
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const gap = 10;

  if (horizontal) {
    if (targetCenter.x >= sourceCenter.x) {
      return {
        x1: source.x + source.width + gap,
        y1: sourceCenter.y,
        x2: target.x - gap,
        y2: targetCenter.y,
      };
    }
    return {
      x1: source.x - gap,
      y1: sourceCenter.y,
      x2: target.x + target.width + gap,
      y2: targetCenter.y,
    };
  }

  if (targetCenter.y >= sourceCenter.y) {
    return {
      x1: sourceCenter.x,
      y1: source.y + source.height + gap,
      x2: targetCenter.x,
      y2: target.y - gap,
    };
  }

  return {
    x1: sourceCenter.x,
    y1: source.y - gap,
    x2: targetCenter.x,
    y2: target.y + target.height + gap,
  };
}

function rectCenter(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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
  element: WhiteboardElement | undefined
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
