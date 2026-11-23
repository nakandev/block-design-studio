import { BaseEdge, useEdges, useNodes, type EdgeProps } from '@xyflow/react'
import type { Edge } from '@xyflow/react'

type Point = { x: number; y: number }
type Obstacle = { left: number; right: number; top: number; bottom: number }
type Segment = { a: Point; b: Point }

const STUB = 24
const CLEARANCE = 12
const LANE_GAP = 24

function simplify(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (previous && previous.x === point.x && previous.y === point.y) continue
    if (result.length > 1) {
      const before = result[result.length - 2]
      if ((before.x === previous!.x && previous!.x === point.x)
        || (before.y === previous!.y && previous!.y === point.y)) result.pop()
    }
    result.push(point)
  }
  return result
}

function pointInObstacle(point: Point, obstacle: Obstacle): boolean {
  return point.x >= obstacle.left && point.x <= obstacle.right
    && point.y >= obstacle.top && point.y <= obstacle.bottom
}

function intersectsObstacle(a: Point, b: Point, obstacle: Obstacle): boolean {
  if (pointInObstacle(a, obstacle) || pointInObstacle(b, obstacle)) return true
  if (a.y === b.y) {
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    if (right < obstacle.left || left > obstacle.right) return false
    return obstacle.top < a.y && a.y < obstacle.bottom
  }
  if (a.x === b.x) {
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y, b.y)
    if (bottom < obstacle.top || top > obstacle.bottom) return false
    return obstacle.left < a.x && a.x < obstacle.right
  }
  return false
}

function toSegments(points: Point[]): Segment[] {
  return points.slice(1).map((point, index) => ({ a: points[index], b: point }))
}

function overlapsVertical(a: Segment, b: Segment): boolean {
  if (a.a.x !== a.b.x || b.a.x !== b.b.x || a.a.x !== b.a.x) return false
  const aTop = Math.min(a.a.y, a.b.y)
  const aBottom = Math.max(a.a.y, a.b.y)
  const bTop = Math.min(b.a.y, b.b.y)
  const bBottom = Math.max(b.a.y, b.b.y)
  return Math.min(aBottom, bBottom) - Math.max(aTop, bTop) > 1
}

function routeEdge(
  source: Point,
  target: Point,
  obstacles: Obstacle[],
  reservedSegments: Segment[],
  lane: number,
): Point[] {
  const start = { x: source.x + STUB, y: source.y }
  const end = { x: target.x - STUB, y: target.y }
  const minX = Math.min(start.x, end.x, ...obstacles.map((item) => item.left)) - CLEARANCE * 3
  const maxX = Math.max(start.x, end.x, ...obstacles.map((item) => item.right)) + CLEARANCE * 3
  const minY = Math.min(source.y, target.y, ...obstacles.map((item) => item.top)) - CLEARANCE * 3
  const maxY = Math.max(source.y, target.y, ...obstacles.map((item) => item.bottom)) + CLEARANCE * 3

  const xs = new Set<number>([start.x, end.x, (start.x + end.x) / 2])
  const ys = new Set<number>([source.y, target.y, (source.y + target.y) / 2])
  for (let x = minX; x <= maxX; x += LANE_GAP) xs.add(x)
  for (let y = minY; y <= maxY; y += LANE_GAP) ys.add(y)

  for (const obstacle of obstacles) {
    xs.add(obstacle.left - CLEARANCE)
    xs.add(obstacle.right + CLEARANCE)
    ys.add(obstacle.top - CLEARANCE)
    ys.add(obstacle.bottom + CLEARANCE)
  }

  const verticalXs = [...xs].sort((a, b) => {
    if (lane < 0) return a - b
    if (lane > 0) return b - a
    return Math.abs(a - (start.x + end.x) / 2) - Math.abs(b - (start.x + end.x) / 2)
  })
  const horizontalYs = [...ys].sort((a, b) => {
    const preferredA = (source.y + target.y) / 2 + lane * LANE_GAP
    return Math.abs(a - preferredA) - Math.abs(b - preferredA)
  })

  let best: Point[] | undefined
  let bestScore = Number.POSITIVE_INFINITY

  // Prefer a three-segment orthogonal route first. These routes keep all
  // verticals at distinct x coordinates and are usually visually cleaner.
  for (const middleX of verticalXs) {
    for (const middleY of horizontalYs) {
      const candidates = [
        simplify([source, start, { x: middleX, y: start.y }, { x: middleX, y: target.y }, end, target]),
        simplify([source, start, { x: start.x, y: middleY }, { x: middleX, y: middleY }, { x: middleX, y: end.y }, end, target]),
        simplify([source, start, { x: middleX, y: start.y }, { x: middleX, y: middleY }, { x: end.x, y: middleY }, end, target]),
        simplify([source, start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end, target]),
      ]

      for (const candidate of candidates) {
        const segments = toSegments(candidate)
        if (segments.some((segment) => obstacles.some((obstacle) => intersectsObstacle(segment.a, segment.b, obstacle)))) continue

        const newVerticalSegments = segments.filter((segment) => segment.a.x === segment.b.x)
        const overlaps = newVerticalSegments.reduce((count, segment) =>
          count + reservedSegments.filter((reserved) => overlapsVertical(segment, reserved)).length,
        0)
        const uniqueVerticalXs = new Set(newVerticalSegments.map((segment) => segment.a.x)).size
        const length = segments.reduce((total, segment) =>
          total + Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y), 0)
        const bends = candidate.length - 2
        const yBalance = newVerticalSegments.reduce((total, segment) => {
          const mid = (segment.a.y + segment.b.y) / 2
          return total + Math.abs(mid - (source.y + target.y) / 2)
        }, 0)
        const score = length + bends * 30 + overlaps * 500 + yBalance * 0.08
          + Math.abs(middleX - (start.x + end.x) / 2) * 0.04

        if (score < bestScore) {
          best = candidate
          bestScore = score
        }
      }
    }
  }

  if (!best) {
    const outsideLane = minY - LANE_GAP * (Math.abs(lane) + 1)
    best = [source, start, { x: start.x, y: outsideLane }, { x: end.x, y: outsideLane }, end, target]
  }
  return best
}

function toPath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export default function OrthogonalEdge(props: EdgeProps) {
  const nodes = useNodes()
  const edges = useEdges() as Edge[]
  const sourceNode = nodes.find((node) => node.id === props.source)
  const targetNode = nodes.find((node) => node.id === props.target)
  if (!sourceNode || !targetNode) return null

  const obstacles = nodes
    .filter((node) => node.id !== props.source && node.id !== props.target)
    .map((node) => {
      const width = node.measured?.width ?? node.width ?? 196
      const height = node.measured?.height ?? node.height ?? 96
      return {
        left: node.position.x - CLEARANCE,
        right: node.position.x + width + CLEARANCE,
        top: node.position.y - CLEARANCE,
        bottom: node.position.y + height + CLEARANCE,
      }
    })

  const orderedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id))
  const edgeIndex = orderedEdges.findIndex((edge) => edge.id === props.id)
  const lane = edgeIndex === 0 ? 0 : (edgeIndex % 2 ? 1 : -1) * Math.ceil(edgeIndex / 2)

  const reservedSegments: Segment[] = []
  // Reserve already-routed vertical segments by endpoint distance. When all
  // visible routing calculations are based on the same grid, this prevents
  // independent edges from choosing the exact same vertical x coordinate.
  for (const edge of orderedEdges) {
    if (edge.id === props.id) break
    const source = nodes.find((node) => node.id === edge.source)
    const target = nodes.find((node) => node.id === edge.target)
    if (!source || !target) continue
    const sourceX = edge.sourceHandle ? props.sourceX : source.position.x
    const targetX = edge.targetHandle ? props.targetX : target.position.x
    const sourceY = source.position.y
    const targetY = target.position.y
    reservedSegments.push({ a: { x: sourceX, y: sourceY }, b: { x: sourceX, y: targetY } })
    reservedSegments.push({ a: { x: targetX, y: sourceY }, b: { x: targetX, y: targetY } })
  }

  const path = routeEdge(
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
    obstacles,
    reservedSegments,
    lane,
  )

  return <BaseEdge
    id={props.id}
    path={toPath(path)}
    markerEnd={props.markerEnd}
    markerStart={props.markerStart}
    style={props.style}
    interactionWidth={props.interactionWidth}
  />
}
