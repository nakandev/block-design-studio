import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { BlockPort, BlockTemplate, InterfaceDefinition, InterfaceSignal, ParameterValue } from './types'
import { validateAddressRanges } from './addressMapValidation'
import { canMergeDefinition } from './designDefinitions'
import { resolveWidth } from './widthExpression'

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

function roleSignals(definition: InterfaceDefinition, role: string, external: boolean): InterfaceSignal[] {
  const flip = (direction: InterfaceSignal['direction']) => direction === 'inout' ? direction : direction === 'input' ? 'output' : 'input'
  return [
    ...(definition.signals ?? []).map((signal) => ({ ...signal, direction: role === 'slave' ? flip(signal.direction) : signal.direction })),
    ...(role === 'master' ? definition.masterSignals ?? [] : definition.slaveSignals ?? []),
  ].map((signal) => external ? { ...signal, direction: flip(signal.direction) } : signal)
}

export function validateDesign(nodes: BlockNode[], edges: Edge[], templates?: BlockTemplate[], interfaces?: InterfaceDefinition[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const templatesByKind = new Map((templates ?? []).map((template) => [template.kind, template]))
  const interfacesByName = new Map((interfaces ?? []).map((item) => [item.name, item]))
  const names = new Map<string, string>()
  const defines = new Map<string, { value: string; label: string }>()
  const connected = new Set<string>()
  const targets = new Set<string>()
  const reverseDrivers = new Set<string>()
  const portKey = (nodeId: string, portId: string | null | undefined) => JSON.stringify([nodeId, portId])
  for (const node of nodes) {
    if (node.type !== 'block') continue
    const label = node.data.label
    if (!label?.trim()) issues.push({ severity: 'error', message: `${node.id}: block name is empty`, nodeId: node.id })
    else {
      const instance = `u_${label}`.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
      const previous = names.get(instance)
      if (previous) issues.push({ severity: 'warning', message: `${label}: generated instance name ${instance} collides with ${previous}`, nodeId: node.id })
      else names.set(instance, label)
    }
    if (templates) {
      const template = templatesByKind.get(node.data.kind)
      if (!template) issues.push({ severity: 'warning', message: `${label}: block definition ${node.data.kind} is not loaded`, nodeId: node.id })
      else if (!canMergeDefinition(node.data.definitionSource, template.source)) issues.push({ severity: 'warning', message: `${label}: loaded block definition source differs from the design`, nodeId: node.id })
    }
    const portNames = new Map<string, string>()
    for (const port of node.data.ports) {
      const role = port.type?.match(/^(.+)\.(master|slave)$/)
      const definition = role && interfacesByName.get(role[1])
      const sourceMatches = !port.interfaceSource?.path || (port.interfaceSource.path === definition?.source?.path && port.interfaceSource.version === definition.source?.version)
      const names = role ? definition && sourceMatches ? roleSignals(definition, role[2], false).map((signal) => `${port.name}_${signal.name}`) : [] : [port.name]
      for (const raw of names) {
        let name = raw.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
        if (!name) name = 'port'
        if (!/^[A-Za-z_]/.test(name)) name = `port_${name}`
        const previous = portNames.get(name)
        if (previous) issues.push({ severity: 'warning', message: `${label}: generated port name ${name} collides between ${previous} and ${port.name}`, nodeId: node.id })
        else portNames.set(name, port.name)
      }
    }
    for (const [name, setting] of Object.entries(node.data.defines ?? {})) {
      if (!setting.enabled) continue
      const value = setting.value.trim() || '1'
      const previous = defines.get(name)
      if (previous && previous.value !== value) {
        issues.push({ severity: 'warning', message: `${label}: define ${name} differs from ${previous.label} (${value} vs ${previous.value}); equivalence cannot be verified`, nodeId: node.id })
      } else if (!previous) defines.set(name, { value, label })
    }
  }
  if (interfaces) {
    for (const node of nodes) for (const port of node.data.ports) {
      const name = port.type?.match(/^(.+)\.(?:master|slave)$/)?.[1]
      if (!name) continue
      const definition = interfacesByName.get(name)
      if (!definition) issues.push({ severity: 'warning', message: `${node.data.label}.${port.name}: interface definition ${name} is not loaded`, nodeId: node.id })
      else if (port.interfaceSource?.path && (port.interfaceSource.path !== definition.source?.path || port.interfaceSource.version !== definition.source?.version)) issues.push({ severity: 'warning', message: `${node.data.label}.${port.name}: loaded interface definition source differs from the design`, nodeId: node.id })
      else if (![...(definition.signals ?? []), ...(definition.masterSignals ?? []), ...(definition.slaveSignals ?? [])].length) issues.push({ severity: 'warning', message: `${node.data.label}.${port.name}: interface ${name} has no signal definitions; compatibility cannot be verified`, nodeId: node.id })
    }
  }
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
    const sourceRole = sourcePort?.type?.match(/^(.+)\.(master|slave)$/)
    const targetRole = targetPort?.type?.match(/^(.+)\.(master|slave)$/)
    const definition = sourceRole && interfacesByName.get(sourceRole[1])
    const sourceMatches = !sourcePort?.interfaceSource?.path || (sourcePort.interfaceSource.path === definition?.source?.path && sourcePort.interfaceSource.version === definition.source?.version)
    const targetMatches = !targetPort?.interfaceSource?.path || (targetPort.interfaceSource.path === definition?.source?.path && targetPort.interfaceSource.version === definition.source?.version)
    const templateMatches = (node: BlockNode | undefined) => !templates || node?.type !== 'block' || (templatesByKind.has(node.data.kind) && canMergeDefinition(node.data.definitionSource, templatesByKind.get(node.data.kind)?.source))
    if (!error && source && target && sourceRole && targetRole && definition && sourceMatches && targetMatches && templateMatches(source) && templateMatches(target)) {
      const from = roleSignals(definition, sourceRole[2], !!source.type?.startsWith('external'))
      const to = roleSignals(definition, targetRole[2], !!target.type?.startsWith('external'))
      const targetSignals = new Map(to.map((signal) => [signal.name, signal]))
      const sourceNames = new Set(from.map((signal) => signal.name))
      const unmatched = [...from.filter((signal) => !targetSignals.has(signal.name)).map((signal) => signal.name), ...to.filter((signal) => !sourceNames.has(signal.name)).map((signal) => signal.name)]
      if (unmatched.length) issues.push({ severity: 'warning', message: `${label}: role-specific signals ${unmatched.join(', ')} cannot be compared automatically`, edgeId: edge.id })
      const parameters = (node: BlockNode): Record<string, ParameterValue> => ({ ...definition.parameters, ...templatesByKind.get(node.data.kind)?.parameters, ...node.data.parameters })
      for (const signal of from) {
        const other = targetSignals.get(signal.name)
        if (!other) continue
        if (signal.direction !== 'inout' && other.direction !== 'inout' && signal.direction === other.direction) {
          issues.push({ severity: 'error', message: `${label}: ${signal.name} has incompatible signal directions`, edgeId: edge.id })
        }
        if (signal.direction === 'input' && other.direction === 'output') {
          const driverKey = JSON.stringify([edge.source, edge.sourceHandle, signal.name])
          if (reverseDrivers.has(driverKey)) issues.push({ severity: 'error', message: `${label}: ${signal.name} has multiple drivers`, edgeId: edge.id })
          reverseDrivers.add(driverKey)
        }
        const left = resolveWidth(signal.width, parameters(source))
        const right = resolveWidth(other.width, parameters(target))
        if (left === undefined || right === undefined) issues.push({ severity: 'warning', message: `${label}: ${signal.name} width cannot be verified`, edgeId: edge.id })
        else if (left !== right) issues.push({ severity: 'error', message: `${label}: ${signal.name} signal width mismatch (${left} vs ${right})`, edgeId: edge.id })
      }
    }
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
