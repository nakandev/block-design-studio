import { BaseEdge, useEdges, useNodes, type EdgeProps } from '@xyflow/react'
import type { Edge } from '@xyflow/react'

type Point = { x: number; y: number }
type Obstacle = { left: number; right: number; top: number; bottom: number }

const STUB = 24
const CLEARANCE = 12
const LANE_GAP = 24

function intersectsSegment(a: Point, b: Point, obstacle: Obstacle): boolean {
  if (a.y === b.y) {
    return a.y > obstacle.top && a.y < obstacle.bottom
      && Math.max(Math.min(a.x, b.x), obstacle.left) < Math.min(Math.max(a.x, b.x), obstacle.right)
  }
  if (a.x === b.x) {
    return a.x > obstacle.left && a.x < obstacle.right
      && Math.max(Math.min(a.y, b.y), obstacle.top) < Math.min(Math.max(a.y, b.y), obstacle.bottom)
  }
  return true
}

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

function routeEdge(
  source: Point,
  target: Point,
  obstacles: Obstacle[],
  lane: number,
): Point[] {
  const start = { x: source.x + STUB, y: source.y }
  const end = { x: target.x - STUB, y: target.y }
  const minX = Math.min(start.x, end.x, ...obstacles.map((item) => item.left)) - CLEARANCE * 2
  const maxX = Math.max(start.x, end.x, ...obstacles.map((item) => item.right)) + CLEARANCE * 2
  const minY = Math.min(source.y, target.y, ...obstacles.map((item) => item.top)) - CLEARANCE * 2
  const maxY = Math.max(source.y, target.y, ...obstacles.map((item) => item.bottom)) + CLEARANCE * 2

  const xCandidates = new Set<number>([start.x, end.x, (start.x + end.x) / 2])
  const yCandidates = new Set<number>([source.y, target.y])
  for (let x = minX; x <= maxX; x += LANE_GAP) xCandidates.add(x)
  for (let y = minY; y <= maxY; y += LANE_GAP) yCandidates.add(y)
  for (const obstacle of obstacles) {
    xCandidates.add(obstacle.left - CLEARANCE)
    xCandidates.add(obstacle.right + CLEARANCE)
    yCandidates.add(obstacle.top - CLEARANCE)
    yCandidates.add(obstacle.bottom + CLEARANCE)
  }

  const xs = [...xCandidates]
  const laneCenter = (source.y + target.y) / 2 + lane * LANE_GAP
  const ys = [...yCandidates].sort((a, b) => Math.abs(a - laneCenter) - Math.abs(b - laneCenter))
  let best: Point[] | undefined
  let bestScore = Number.POSITIVE_INFINITY

  for (const y of ys) {
    for (const x1 of xs) {
      for (const x2 of xs) {
        const candidate = simplify([
          source,
          start,
          { x: x1, y: start.y },
          { x: x1, y },
          { x: x2, y },
          { x: x2, y: end.y },
          end,
          target,
        ])
        if (candidate.slice(1, -1).some((point, index) =>
          obstacles.some((obstacle) => intersectsSegment(point, candidate[index + 2], obstacle)),
        )) continue

        let length = 0
        for (let index = 1; index < candidate.length; index += 1) {
          length += Math.abs(candidate[index].x - candidate[index - 1].x)
            + Math.abs(candidate[index].y - candidate[index - 1].y)
        }
        const bends = Math.max(0, candidate.length - 2)
        const score = length + bends * 18 + Math.abs(y - laneCenter) * 0.35
        if (score < bestScore) {
          best = candidate
          bestScore = score
        }
      }
    }
  }

  // If a crowded layout has no clear candidate, use a broad outside lane rather
  // than drawing a diagonal or silently reverting to a node-crossing bezier.
  if (!best) {
    const y = minY - LANE_GAP * (Math.abs(lane) + 1)
    best = [source, start, { x: start.x, y }, { x: end.x, y }, end, target]
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
  const path = routeEdge(
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
    obstacles,
    lane,
  )

  // Keep the references explicit so node deletion during an edit doesn't leave
  // an edge render attempting to route from stale endpoints.
  if (!sourceNode || !targetNode) return null

  return <BaseEdge
    id={props.id}
    path={toPath(path)}
    markerEnd={props.markerEnd}
    markerStart={props.markerStart}
    style={props.style}
    interactionWidth={props.interactionWidth}
  />
}
