import { describe, expect, it } from "vitest";
import {
  detectMalformedLayoutWarnings,
  repairWhiteboardLayout,
} from "../main/whiteboard/elements";
import type { WhiteboardElement } from "../main/whiteboard/types";

describe("repairWhiteboardLayout", () => {
  it("wraps crowded three-node diagrams and removes arrow labels that collide in compact previews", () => {
    const crowdedThreeNodeDiagram: WhiteboardElement[] = [
      {
        id: "challenge",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Challenge" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "meaning",
        type: "rectangle",
        x: 220,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Meaning" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "start",
        type: "rectangle",
        x: 440,
        y: 0,
        width: 160,
        height: 56,
        label: { text: "Start" },
        backgroundColor: "#a5d8ff",
      },
      {
        id: "arrow-a",
        type: "arrow",
        x: 160,
        y: 28,
        width: 60,
        height: 0,
        points: [
          [0, 0],
          [60, 0],
        ],
        label: { text: "means" },
        endArrowType: "arrow",
      },
      {
        id: "arrow-b",
        type: "arrow",
        x: 380,
        y: 28,
        width: 60,
        height: 0,
        points: [
          [0, 0],
          [60, 0],
        ],
        label: { text: "starts" },
        endArrowType: "arrow",
      },
    ];

    const repaired = repairWhiteboardLayout(crowdedThreeNodeDiagram);
    const shapes = repaired.filter((element) => element.type === "rectangle");
    const arrows = repaired.filter((element) => element.type === "arrow");
    const left = Math.min(...shapes.map((shape) => shape.x));
    const right = Math.max(...shapes.map((shape) => shape.x + (shape.width ?? 0)));
    const top = Math.min(...shapes.map((shape) => shape.y));
    const bottom = Math.max(...shapes.map((shape) => shape.y + (shape.height ?? 0)));

    expect(right - left).toBeLessThanOrEqual(700);
    expect(bottom - top).toBeGreaterThan(120);
    expect(arrows.every((arrow) => !arrow.label?.text)).toBe(true);
    expect(detectMalformedLayoutWarnings(repaired)).toEqual([]);
  });

  it("preserves non-colliding arrow labels in simple diagrams", () => {
    const simpleDiagram: WhiteboardElement[] = [
      {
        id: "source",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 180,
        height: 80,
        label: { text: "Source" },
      },
      {
        id: "target",
        type: "rectangle",
        x: 360,
        y: 0,
        width: 180,
        height: 80,
        label: { text: "Target" },
      },
      {
        id: "relationship",
        type: "arrow",
        x: 180,
        y: 40,
        width: 180,
        height: 0,
        points: [
          [0, 0],
          [180, 0],
        ],
        label: { text: "causes" },
        endArrowType: "arrow",
      },
    ];

    const repaired = repairWhiteboardLayout(simpleDiagram);
    const arrow = repaired.find((element) => element.id === "relationship");

    expect(arrow?.label?.text).toBe("causes");
    expect(detectMalformedLayoutWarnings(repaired)).toEqual([]);
  });
});
