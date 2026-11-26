import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { BlockPort } from './types'
import { connectionError } from './designValidation'

export interface Subdesign {
  id: string
  name: string
  nodes: BlockNode[]
  edges: Edge[]
}

export interface DesignGraph {
  nodes: BlockNode[]
  edges: Edge[]
}

export interface ParentConnectionImpact {
  graphId: string
  edge: Edge
}

export function readSubdesigns(value: unknown, rootNodes: BlockNode[] = []): Subdesign[] {
  if (value === undefined) value = []
  if (!Array.isArray(value)) throw new Error('Subdesigns must be an array')
  const seen = new Set<string>()
  const result = value.map((entry: unknown): Subdesign => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid subdesign')
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || seen.has(item.id)
      || typeof item.name !== 'string' || !Array.isArray(item.nodes) || !Array.isArray(item.edges)) {
      throw new Error('Subdesigns need unique IDs, names, nodes and edges')
    }
    seen.add(item.id)
    const nodeIds = new Set<string>()
    for (const raw of item.nodes) {
      if (!raw || typeof raw !== 'object') throw new Error(`Invalid node in subdesign ${item.name}`)
      const node = raw as Record<string, unknown>
      if (typeof node.id !== 'string' || !node.id || nodeIds.has(node.id) || typeof node.type !== 'string'
        || !node.position || typeof node.position !== 'object' || Array.isArray(node.position)
        || !node.data || typeof node.data !== 'object' || Array.isArray(node.data)) {
        throw new Error(`Invalid or duplicate node in subdesign ${item.name}`)
      }
      const position = node.position as Record<string, unknown>
      const data = node.data as Record<string, unknown>
      if (typeof position.x !== 'number' || !Number.isFinite(position.x) || typeof position.y !== 'number' || !Number.isFinite(position.y)
        || typeof data.label !== 'string' || typeof data.kind !== 'string' || !Array.isArray(data.ports)
        || !data.parameters || typeof data.parameters !== 'object' || Array.isArray(data.parameters)) {
        throw new Error(`Invalid node data in subdesign ${item.name}`)
      }
      const portIds = new Set<string>()
      for (const rawPort of data.ports) {
        if (!rawPort || typeof rawPort !== 'object') throw new Error(`Invalid port in subdesign ${item.name}`)
        const port = rawPort as Record<string, unknown>
        if (typeof port.id !== 'string' || !port.id || portIds.has(port.id) || typeof port.name !== 'string'
          || (port.direction !== 'input' && port.direction !== 'output')
          || (port.type !== undefined && (typeof port.type !== 'string' || !/^(clock|reset|.+\.(master|slave))$/.test(port.type)))
          || (port.width !== undefined && (typeof port.width !== 'number' || !Number.isInteger(port.width) || port.width < 1))) {
          throw new Error(`Invalid or duplicate port in subdesign ${item.name}`)
        }
        portIds.add(port.id)
      }
      if (node.type.startsWith('external') && data.ports.length !== 1) throw new Error(`External node ${node.id} must have one port`)
      nodeIds.add(node.id)
    }
    const edgeIds = new Set<string>()
    for (const raw of item.edges) {
      if (!raw || typeof raw !== 'object') throw new Error(`Invalid edge in subdesign ${item.name}`)
      const edge = raw as Record<string, unknown>
      if (typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id)
        || typeof edge.source !== 'string' || typeof edge.target !== 'string'
        || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)
        || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string') {
        throw new Error(`Invalid or duplicate edge in subdesign ${item.name}`)
      }
      edgeIds.add(edge.id)
    }
    return { id: item.id, name: item.name, nodes: item.nodes as BlockNode[], edges: item.edges as Edge[] }
  })
  const byId = new Map(result.map((item) => [item.id, item]))
  const visited = new Set<string>()
  const visit = (id: string, active: Set<string>) => {
    if (active.has(id)) throw new Error(`Circular subdesign reference: ${id}`)
    if (visited.has(id)) return
    const design = byId.get(id)
    if (!design) throw new Error(`Missing subdesign: ${id}`)
    const next = new Set(active).add(id)
    for (const node of design.nodes) {
      if (node.type === 'subdesign') {
        if (typeof node.data.subdesignId !== 'string' || !node.data.subdesignId) throw new Error(`Missing subdesign reference on ${node.id}`)
        visit(node.data.subdesignId, next)
      }
    }
    visited.add(id)
  }
  for (const design of result) visit(design.id, new Set())
  for (const node of rootNodes) {
    if (node.type !== 'subdesign') continue
    if (typeof node.data?.subdesignId !== 'string' || !node.data.subdesignId) throw new Error(`Missing subdesign reference on ${node.id}`)
    visit(node.data.subdesignId, new Set())
  }
  return result
}

export function subdesignPorts(nodes: BlockNode[]): BlockPort[] {
  return nodes.filter((node) => node.type?.startsWith('external')).map((node) => {
    const port = node.data.ports[0]
    if (!port) throw new Error(`External node ${node.id} has no port`)
    return {
      ...port,
      id: node.id,
      name: node.data.label,
      direction: port.direction === 'input' ? 'output' : 'input',
    }
  })
}

export function syncSubdesignPorts(
  graphs: Record<string, DesignGraph>,
  subdesignId: string,
  internalNodes: BlockNode[],
): { graphs: Record<string, DesignGraph>; removed: ParentConnectionImpact[] } {
  const ports = subdesignPorts(internalNodes)
  const removed: ParentConnectionImpact[] = []
  const updated = Object.fromEntries(Object.entries(graphs).map(([graphId, graph]) => {
    const nodes = graph.nodes.map((node) => node.type === 'subdesign' && node.data.subdesignId === subdesignId
      ? { ...node, data: { ...node.data, ports } }
      : node)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const oldById = new Map(graph.nodes.map((node) => [node.id, node]))
    const edges = graph.edges.filter((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!(source?.type === 'subdesign' && source.data.subdesignId === subdesignId)
        && !(target?.type === 'subdesign' && target.data.subdesignId === subdesignId)) return true
      const sourcePort = source?.data.ports.find((port) => port.id === edge.sourceHandle)
      const targetPort = target?.data.ports.find((port) => port.id === edge.targetHandle)
      const oldSource = oldById.get(edge.source)?.data.ports.find((port) => port.id === edge.sourceHandle)
      const oldTarget = oldById.get(edge.target)?.data.ports.find((port) => port.id === edge.targetHandle)
      const signature = (port?: BlockPort) => port && JSON.stringify([port.direction, port.type, port.width])
      if (signature(sourcePort) === signature(oldSource) && signature(targetPort) === signature(oldTarget)) return true
      if (!connectionError(sourcePort, targetPort, source, target)) return true
      removed.push({ graphId, edge })
      return false
    })
    return [graphId, { nodes, edges }]
  }))
  return { graphs: updated, removed }
}
