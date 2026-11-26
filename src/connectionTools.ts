import type { Connection, Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { BlockPort } from './types'
import { connectionError } from './designValidation'

export interface PortRef { nodeId: string; portId: string }

export function connectionFor(a: PortRef, b: PortRef, nodes: BlockNode[], edges: Edge[]): Connection | null {
  const first = nodes.find((node) => node.id === a.nodeId)
  const second = nodes.find((node) => node.id === b.nodeId)
  const firstPort = first?.data.ports.find((port) => port.id === a.portId)
  const secondPort = second?.data.ports.find((port) => port.id === b.portId)
  if (!first || !second || !firstPort || !secondPort || first.id === second.id || firstPort.direction === secondPort.direction) return null
  const [sourceNode, sourcePort, targetNode, targetPort] = firstPort.direction === 'output'
    ? [first, firstPort, second, secondPort] : [second, secondPort, first, firstPort]
  if (connectionError(sourcePort, targetPort, sourceNode, targetNode) || edges.some((edge) => edge.target === targetNode.id && edge.targetHandle === targetPort.id)) return null
  return { source: sourceNode.id, sourceHandle: sourcePort.id, target: targetNode.id, targetHandle: targetPort.id }
}

export function connectionCandidates(ref: PortRef, nodes: BlockNode[], edges: Edge[]) {
  return nodes.flatMap((node) => node.data.ports.flatMap((port) => {
    const connection = connectionFor(ref, { nodeId: node.id, portId: port.id }, nodes, edges)
    return connection ? [{ node, port, connection }] : []
  }))
}

export function externalNodeFor(node: BlockNode, port: BlockPort, nodes: BlockNode[], id: string): BlockNode {
  const isInput = port.direction === 'input'
  const interfaceMatch = port.type?.match(/^(.+)\.(master|slave)$/)
  const role = interfaceMatch && (node.type?.startsWith('external') ? (interfaceMatch[2] === 'master' ? 'slave' : 'master') : interfaceMatch[2])
  const type = interfaceMatch ? `externalInterface${role === 'master' ? 'Master' : 'Slave'}`
    : port.type === 'clock' ? 'externalClock' : port.type === 'reset' ? 'externalReset' : isInput ? 'externalInput' : 'externalOutput'
  const base = `external_${node.data.label}_${port.name}`.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/_+$/g, '') || 'external_port'
  const labels = new Set(nodes.map((item) => item.data.label))
  let label = base
  for (let suffix = 2; labels.has(label); suffix++) label = `${base}_${suffix}`
  const externalPort: BlockPort = {
    id: 'port', name: label, direction: isInput ? 'output' : 'input',
    ...(interfaceMatch && role ? { type: `${interfaceMatch[1]}.${role}` as BlockPort['type'], ...((port.interfaceSource ?? node.data.interfaceSources?.[interfaceMatch[1]]) ? { interfaceSource: { ...(port.interfaceSource ?? node.data.interfaceSources![interfaceMatch[1]]) } } : {}) }
      : port.type ? { type: port.type } : { width: port.width }),
  }
  const position = { x: node.position.x + (isInput ? -260 : 260), y: node.position.y }
  while (nodes.some((item) => Math.abs(item.position.x - position.x) < 200 && Math.abs(item.position.y - position.y) < 100)) position.y += 112
  return {
    id, type, position,
    data: { label, kind: `External ${interfaceMatch ? `${interfaceMatch[1]} ${role}` : port.type ?? (isInput ? 'Input' : 'Output')}`, ports: [externalPort], parameters: {} },
  }
}
