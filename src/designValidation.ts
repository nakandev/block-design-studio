import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { BlockPort } from './types'
import { validateAddressRanges } from './addressMapValidation'

export interface ValidationIssue {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
  addressMap?: boolean
}

export function connectionError(source?: BlockPort, target?: BlockPort, sourceNode?: BlockNode, targetNode?: BlockNode) {
  if (!source || !target) return 'Connect valid ports'
  if (source.direction !== 'output' || target.direction !== 'input') return 'Connect an output port to an input port'
  const sourceIsExternal = !!sourceNode?.type?.startsWith('external')
  const targetIsExternal = !!targetNode?.type?.startsWith('external')
  const sourceInterface = source.type?.match(/^(.+)\.(master|slave)$/)
  const targetInterface = target.type?.match(/^(.+)\.(master|slave)$/)
  if (sourceInterface || targetInterface) {
    if (!sourceInterface || !targetInterface || sourceInterface[1] !== targetInterface[1]) return 'Interface type mismatch'
    const sourceRole = sourceInterface[2]
    const targetRole = targetInterface[2]
    // External roles are viewed from outside the design.
    if (sourceIsExternal && targetIsExternal) return sourceRole === 'slave' && targetRole === 'master' ? null : 'Connect an external slave to an external master'
    if (sourceIsExternal || targetIsExternal) return sourceRole === targetRole ? null : 'Connect an external port to a block port with the same role'
    return sourceRole === 'master' && targetRole === 'slave' ? null : 'Connect a matching interface master to slave'
  }
  if (source.type || target.type) return source.type === target.type ? null : `Type mismatch: ${source.type ?? 'signal'} cannot connect to ${target.type ?? 'signal'}`
  return source.width === target.width ? null : `Port width mismatch: ${source.width}-bit output cannot connect to ${target.width}-bit input`
}

export function validateDesign(nodes: BlockNode[], edges: Edge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const connected = new Set<string>()
  const targets = new Set<string>()
  const portKey = (nodeId: string, portId: string | null | undefined) => JSON.stringify([nodeId, portId])
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const sourcePort = source?.data.ports.find((port) => port.id === edge.sourceHandle)
    const targetPort = target?.data.ports.find((port) => port.id === edge.targetHandle)
    if (sourcePort) connected.add(portKey(edge.source, edge.sourceHandle))
    if (targetPort) connected.add(portKey(edge.target, edge.targetHandle))
    const label = `${source?.data.label ?? edge.source}.${sourcePort?.name ?? edge.sourceHandle ?? '?'} → ${target?.data.label ?? edge.target}.${targetPort?.name ?? edge.targetHandle ?? '?'}`
    const error = !source || !target ? 'Connection refers to a missing node'
      : edge.source === edge.target ? 'Self-connections are not supported'
      : connectionError(sourcePort, targetPort, source, target)
    if (error) issues.push({ severity: 'error', message: `${label}: ${error}`, edgeId: edge.id })
    if (targetPort) {
      const key = portKey(edge.target, edge.targetHandle)
      if (targets.has(key)) issues.push({ severity: 'error', message: `${label}: input port has multiple connections`, edgeId: edge.id })
      targets.add(key)
    }
  }
  for (const node of nodes) {
    for (const port of node.data.ports) {
      if (!connected.has(portKey(node.id, port.id))) issues.push({ severity: 'warning', message: `${node.data.label}.${port.name}: port is not connected`, nodeId: node.id })
    }
    const map = node.data.addressMap
    if (!map) continue
    const groups = 'groups' in map ? map.groups : [{ slavePortId: 'legacy', entries: map.entries }]
    for (const group of groups) {
      const ranges = validateAddressRanges(group.entries.map((entry) => ({ ...entry, baseAddress: entry.baseAddress ?? '', size: entry.size ?? '' })), map.addressWidth)
      for (const range of ranges) {
        if (range.status !== 'Valid' && range.status !== 'Unassigned') {
          const slave = node.data.ports.find((port) => port.id === group.slavePortId)?.name ?? group.slavePortId
          const master = node.data.ports.find((port) => port.id === range.portId)?.name ?? range.portId
          issues.push({ severity: 'error', message: `${node.data.label} address map (${slave} / ${master}): ${range.status}`, nodeId: node.id, addressMap: true })
        }
      }
    }
  }
  return issues.sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'))
}
