import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { Subdesign } from './subdesign'

export function designFingerprint(name: string, nodes: BlockNode[], edges: Edge[]): string {
  const savedNodes = nodes.map(({ selected, dragging, measured, resizing, ...node }) => node)
  const savedEdges = edges.map(({ selected, ...edge }) => edge)
  return JSON.stringify({ name, nodes: savedNodes, edges: savedEdges })
}

export function workspaceFingerprint(name: string, nodes: BlockNode[], edges: Edge[], subdesigns: Subdesign[]): string {
  return JSON.stringify([
    designFingerprint(name, nodes, edges),
    subdesigns.map((design) => [design.id, designFingerprint(design.name, design.nodes, design.edges)]),
  ])
}
