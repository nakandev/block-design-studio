import type { Edge } from '@xyflow/react'
import type { AddressMap, BlockData, BlockPort, PortConfig, PortGenerate } from './types'

const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function validateGenerate(value: unknown, id: string): PortGenerate | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid generate on port ${id}`)
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => key !== 'for' && key !== 'if') || (raw.for === undefined && raw.if === undefined)) throw new Error(`Invalid generate on port ${id}: expected for or if`)
  const generate: PortGenerate = {}
  if (raw.for !== undefined) {
    if (!raw.for || typeof raw.for !== 'object' || Array.isArray(raw.for)) throw new Error(`Invalid generate.for on port ${id}`)
    const loop = raw.for as Record<string, unknown>
    const { index, count, min, max } = loop
    if (Object.keys(loop).some((key) => !['index', 'count', 'min', 'max'].includes(key)) ||
      typeof index !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(index) ||
      typeof min !== 'number' || typeof max !== 'number' || typeof count !== 'number' ||
      !Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(count) ||
      min < 0 || max > 1024 || min > count || count > max || !id.includes(`{${index}}`)) {
      throw new Error(`Invalid generate.for on port ${id}: require index placeholder and 0 <= min <= count <= max <= 1024`)
    }
    generate.for = { index, count, min, max }
  }
  if (raw.if !== undefined) {
    if (!raw.if || typeof raw.if !== 'object' || Array.isArray(raw.if) || Object.keys(raw.if).some((key) => key !== 'default') || typeof (raw.if as Record<string, unknown>).default !== 'boolean') throw new Error(`Invalid generate.if on port ${id}: expected only a boolean default`)
    generate.if = { default: (raw.if as { default: boolean }).default }
  }
  return generate
}

export function expandDefinition(port: BlockPort, count = port.generate?.for?.count ?? 1): BlockPort[] {
  const { generate, ...base } = port
  if (!generate?.for) return [base]
  const placeholder = `{${generate.for.index}}`
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: base.id.split(placeholder).join(String(index)),
    name: base.name.split(placeholder).join(String(index)),
  }))
}

export function validatePortIds(definitions: BlockPort[]) {
  const ids = new Set<string>()
  for (const definition of definitions) {
    const ports = expandDefinition(definition, definition.generate?.for?.max)
    for (const port of ports) {
      if (ids.has(port.id)) throw new Error(`Duplicate generated port id: ${port.id}`)
      ids.add(port.id)
    }
  }
}

export function generatedPorts(definitions: BlockPort[], counts: Record<string, number>, enabled: Record<string, boolean>): BlockPort[] {
  return definitions.flatMap((definition) => expandDefinition(definition, counts[definition.id])
    .filter((port) => !definition.generate?.if || (has(enabled, port.id) ? enabled[port.id] : definition.generate.if.default)))
}

export function completePortConfig(definitions: BlockPort[], counts: Record<string, number>, enabled: Record<string, boolean>): PortConfig {
  const countEntries = Object.entries(counts)
  const enabledEntries = Object.entries(enabled)
  for (const definition of definitions) {
    const loop = definition.generate?.for
    let count = 1
    if (loop) {
      count = has(counts, definition.id) ? counts[definition.id] : loop.count
      if (!Number.isInteger(count) || count < loop.min || count > loop.max) throw new Error(`Invalid count for port ${definition.id}`)
      countEntries.push([definition.id, count])
    }
    if (definition.generate?.if) {
      for (const port of expandDefinition(definition, count)) {
        const value = has(enabled, port.id) ? enabled[port.id] : definition.generate.if.default
        if (typeof value !== 'boolean') throw new Error(`Invalid enabled state for port ${port.id}`)
        enabledEntries.push([port.id, value])
      }
    }
  }
  return { counts: Object.fromEntries(countEntries), enabled: Object.fromEntries(enabledEntries) }
}

export function initialPortConfiguration(definitions: BlockPort[]) {
  const portDefinitions = definitions.map((port) => structuredClone(port))
  return {
    portDefinitions,
    config: { ports: completePortConfig(portDefinitions, {}, {}) },
  }
}

function validateSavedRecord(value: unknown, label: string, isValid: (entry: unknown) => boolean) {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((entry) => !isValid(entry))) {
    throw new Error(`Invalid ${label} in port configuration`)
  }
}

export function migratePortConfiguration(data: BlockData): BlockData {
  const { portCounts, portEnabled, ...rest } = data
  if (data.config !== undefined && (!data.config || typeof data.config !== 'object' || Array.isArray(data.config))) throw new Error('Invalid block config')
  const existing = data.config?.ports
  if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) throw new Error('Invalid port configuration')
  const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const isEnabled = (value: unknown) => typeof value === 'boolean'
  validateSavedRecord(portCounts, 'legacy counts', isCount)
  validateSavedRecord(portEnabled, 'legacy enabled states', isEnabled)
  validateSavedRecord(existing?.counts, 'counts', isCount)
  validateSavedRecord(existing?.enabled, 'enabled states', isEnabled)
  if (!data.portDefinitions && !existing && !portCounts && !portEnabled) return data
  const counts = { ...portCounts, ...existing?.counts }
  const enabled = { ...portEnabled, ...existing?.enabled }
  const ports = data.portDefinitions ? completePortConfig(data.portDefinitions, counts, enabled) : { counts, enabled }
  return { ...rest, config: { ...data.config, ports } }
}

export function adoptPortDefinitions(data: BlockData, definitions: BlockPort[]): BlockData {
  if (data.portDefinitions || !definitions.some((port) => port.generate)) return data
  const config = initialPortConfiguration(definitions)
  const settings = completePortConfig(config.portDefinitions, data.config?.ports?.counts ?? {}, data.config?.ports?.enabled ?? {})
  const expected = generatedPorts(config.portDefinitions, settings.counts, settings.enabled)
  if (expected.length !== data.ports.length || expected.some((port) => !data.ports.some((existing) =>
    existing.id === port.id && existing.name === port.name && existing.type === port.type &&
    existing.direction === port.direction && existing.width === port.width))) return data
  return { ...data, portDefinitions: config.portDefinitions, config: { ...data.config, ports: settings } }
}

export function removeAddressMapPorts(map: AddressMap | undefined, removed: Set<string>, ports: BlockPort[]): AddressMap | undefined {
  if (!map || !removed.size) return map
  if ('entries' in map) {
    const entries = map.entries.filter((entry) => !removed.has(entry.portId))
    if (ports.some((port) => port.type === 'axi.slave' && removed.has(port.id))) {
      return { addressWidth: map.addressWidth, groups: ports.filter((port) => port.type === 'axi.slave' && !removed.has(port.id)).map((port) => ({ slavePortId: port.id, entries: entries.map((entry) => ({ ...entry })) })) }
    }
    return { ...map, entries }
  }
  return { ...map, groups: map.groups.filter((group) => !removed.has(group.slavePortId)).map((group) => ({
    ...group, entries: group.entries.filter((entry) => !removed.has(entry.portId)),
  })) }
}

export function addressMapImpact(map: AddressMap | undefined, removed: Set<string>, ports: BlockPort[]): string[] {
  if (!map) return []
  if ('entries' in map) {
    const slaves = ports.filter((port) => port.type === 'axi.slave')
    return slaves.flatMap((slave) => map.entries
      .filter((entry) => (removed.has(slave.id) || removed.has(entry.portId)) && (entry.baseAddress !== null || entry.size !== null))
      .map((entry) => `${slave.id} / ${entry.portId}`))
  }
  return map.groups.flatMap((group) => group.entries
    .filter((entry) => (removed.has(group.slavePortId) || removed.has(entry.portId)) && (entry.baseAddress !== null || entry.size !== null))
    .map((entry) => `${group.slavePortId} / ${entry.portId}`))
}

export function planPortChange(nodeId: string, data: BlockData, edges: Edge[], counts: Record<string, number>, enabled: Record<string, boolean>, discarded: Set<string>) {
  if (!data.portDefinitions) throw new Error('Port definitions are missing')
  const ports = generatedPorts(data.portDefinitions, counts, enabled)
  const removed = new Set([...discarded, ...data.ports.filter((port) => !ports.some((next) => next.id === port.id)).map((port) => port.id)])
  const disconnected = edges.filter((edge) =>
    (edge.source === nodeId && !!edge.sourceHandle && removed.has(edge.sourceHandle)) ||
    (edge.target === nodeId && !!edge.targetHandle && removed.has(edge.targetHandle)))
  const mappings = addressMapImpact(data.addressMap, removed, data.ports)
  const addressMap = removeAddressMapPorts(data.addressMap, removed, data.ports)
  return {
    removed, disconnected, mappings,
    data: { ...data, ports, config: { ...data.config, ports: completePortConfig(data.portDefinitions, counts, enabled) }, ...(addressMap ? { addressMap } : {}) },
    edges: edges.filter((edge) => !disconnected.includes(edge)),
  }
}
