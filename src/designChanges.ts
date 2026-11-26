import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'

export function designFingerprint(name: string, nodes: BlockNode[], edges: Edge[]): string {
  const savedNodes = nodes.map(({ selected, dragging, measured, resizing, ...node }) => node)
  const savedEdges = edges.map(({ selected, ...edge }) => edge)
  return JSON.stringify({ name, nodes: savedNodes, edges: savedEdges })
}
