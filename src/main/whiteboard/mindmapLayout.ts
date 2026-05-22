import { branchColor, ROOT_COLOR } from './mindmapColors'
import type { MindMapState, WhiteboardElement } from './types'

const ROOT_SIZE = { w: 220, h: 80 }
const L1_SIZE = { w: 200, h: 60 }
const L2_SIZE = { w: 160, h: 50 }
const RADIUS_L1 = 280
const RADIUS_L2 = 180
const SUB_ARC = (2 * Math.PI) / 3
const ARROW_GAP = 6

export function computeMindMapLayout(state: MindMapState): WhiteboardElement[] {
  const out: WhiteboardElement[] = []
  const root = state.nodes.find((n) => n.id === state.rootId)
  if (!root) return out

  out.push(
    makeShape({
      type: 'ellipse',
      id: 'root',
      centerX: 0,
      centerY: 0,
      width: ROOT_SIZE.w,
      height: ROOT_SIZE.h,
      backgroundColor: ROOT_COLOR,
      label: root.label,
      fontSize: 20,
    })
  )

  const firstLevel = state.nodes.filter((n) => n.parentId === 'root')
  if (firstLevel.length === 0) return out

  const angleStep = (2 * Math.PI) / firstLevel.length
  firstLevel.forEach((branch, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    const cx = Math.cos(angle) * RADIUS_L1
    const cy = Math.sin(angle) * RADIUS_L1
    out.push(
      makeShape({
        type: 'rectangle',
        id: branch.id,
        centerX: cx,
        centerY: cy,
        width: L1_SIZE.w,
        height: L1_SIZE.h,
        backgroundColor: branchColor(i, 1),
        label: branch.label,
        fontSize: 16,
      })
    )
    out.push(
      makeArrow({
        id: `arrow-${branch.id}`,
        from: { cx: 0, cy: 0, w: ROOT_SIZE.w, h: ROOT_SIZE.h },
        to: { cx, cy, w: L1_SIZE.w, h: L1_SIZE.h },
      })
    )

    const subs = state.nodes.filter((n) => n.parentId === branch.id)
    if (subs.length === 0) return
    const subAngleStep = subs.length === 1 ? 0 : SUB_ARC / (subs.length - 1)
    const startAngle = angle - SUB_ARC / 2
    subs.forEach((sub, j) => {
      const subAngle = subs.length === 1 ? angle : startAngle + j * subAngleStep
      const sx = cx + Math.cos(subAngle) * RADIUS_L2
      const sy = cy + Math.sin(subAngle) * RADIUS_L2
      out.push(
        makeShape({
          type: 'rectangle',
          id: sub.id,
          centerX: sx,
          centerY: sy,
          width: L2_SIZE.w,
          height: L2_SIZE.h,
          backgroundColor: branchColor(i, 2),
          label: sub.label,
          fontSize: 14,
        })
      )
      out.push(
        makeArrow({
          id: `arrow-${sub.id}`,
          from: { cx, cy, w: L1_SIZE.w, h: L1_SIZE.h },
          to: { cx: sx, cy: sy, w: L2_SIZE.w, h: L2_SIZE.h },
        })
      )
    })
  })

  return out
}

interface ShapeInput {
  type: 'ellipse' | 'rectangle'
  id: string
  centerX: number
  centerY: number
  width: number
  height: number
  backgroundColor: string
  label: string
  fontSize: number
}

function makeShape(s: ShapeInput): WhiteboardElement {
  return {
    type: s.type,
    id: s.id,
    x: s.centerX - s.width / 2,
    y: s.centerY - s.height / 2,
    width: s.width,
    height: s.height,
    backgroundColor: s.backgroundColor,
    fillStyle: 'solid',
    roundness: s.type === 'rectangle' ? { type: 3 } : undefined,
    label: { text: s.label, fontSize: s.fontSize },
  }
}

interface ArrowInput {
  id: string
  from: { cx: number; cy: number; w: number; h: number }
  to: { cx: number; cy: number; w: number; h: number }
}

function makeArrow(a: ArrowInput): WhiteboardElement {
  const dx = a.to.cx - a.from.cx
  const dy = a.to.cy - a.from.cy
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const fromRadius = Math.min(a.from.w, a.from.h) / 2 + ARROW_GAP
  const toRadius = Math.min(a.to.w, a.to.h) / 2 + ARROW_GAP
  const startX = a.from.cx + ux * fromRadius
  const startY = a.from.cy + uy * fromRadius
  const endX = a.to.cx - ux * toRadius
  const endY = a.to.cy - uy * toRadius
  return {
    type: 'arrow',
    id: a.id,
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
    points: [
      [0, 0],
      [endX - startX, endY - startY],
    ],
  }
}
