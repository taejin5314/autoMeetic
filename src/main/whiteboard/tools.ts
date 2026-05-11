import type { EditOperation, WhiteboardElement } from "./types";

/**
 * Format elements as line-numbered text for the agent to reason about.
 * From autopreso: whiteboard-tools.js
 */
export function formatLineNumberedWhiteboard(elements: WhiteboardElement[]): string {
  if (!Array.isArray(elements) || elements.length === 0) {
    return "(empty whiteboard)";
  }

  const width = Math.max(3, String(elements.length).length);
  return elements
    .map(
      (element, index) =>
        `${String(index + 1).padStart(width, "0")}: ${JSON.stringify(element)}`
    )
    .join("\n");
}

/**
 * Apply edit operations to the whiteboard in order.
 * From autopreso: whiteboard-tools.js
 */
export function applyWhiteboardEditOperations(
  elements: WhiteboardElement[],
  operations: EditOperation[]
): WhiteboardElement[] {
  const nextElements = [...elements];

  for (const operation of operations) {
    if (operation.type === "replace") {
      assertLineInRange(operation.line, nextElements.length, `Cannot replace line ${operation.line}`);
      nextElements[operation.line - 1] = operation.element;
      continue;
    }

    if (operation.type === "insert_after") {
      assertLineInInsertRange(
        operation.line,
        nextElements.length,
        `Cannot insert after line ${operation.line}`
      );
      nextElements.splice(operation.line, 0, operation.element);
      continue;
    }

    if (operation.type === "delete") {
      assertLineInRange(operation.line, nextElements.length, `Cannot delete line ${operation.line}`);
      nextElements.splice(operation.line - 1, 1);
      continue;
    }

    throw new Error(`Unknown whiteboard edit operation "${(operation as any).type}".`);
  }

  return nextElements;
}

function assertLineInRange(line: number, lineCount: number, message: string): void {
  if (!Number.isInteger(line) || line < 1 || line > lineCount) {
    throw new Error(
      `${message}; whiteboard has ${lineCount} line${lineCount === 1 ? "" : "s"}.`
    );
  }
}

function assertLineInInsertRange(line: number, lineCount: number, message: string): void {
  if (!Number.isInteger(line) || line < 0 || line > lineCount) {
    throw new Error(
      `${message}; whiteboard has ${lineCount} line${lineCount === 1 ? "" : "s"}.`
    );
  }
}
