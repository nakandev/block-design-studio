import type { BlockNode } from './BlockNode'
import type { BlockData, BlockPort, DefinitionSource, DesignDefinitions, InterfaceDefinition, InterfaceSource } from './types'

export function canMergeDefinition(current: DefinitionSource | undefined, incoming: DefinitionSource | undefined): boolean {
  return !current || (current.path === incoming?.path && current.version === incoming?.version)
}

export function usedInterfaces(ports: BlockPort[], bus?: { interface: string }): string[] {
  const names = new Set<string>()
  for (const port of ports) {
    const name = port.type?.match(/^(.+)\.(?:master|slave)$/)?.[1]
    if (name) names.add(name)
  }
  if (bus) names.add(bus.interface)
  return [...names]
}

export function captureInterfaceSources(names: string[], interfaces: InterfaceDefinition[]): Record<string, DefinitionSource> {
  const definitions = new Map(interfaces.map((item) => [item.name, item.source]))
  return Object.fromEntries(names.flatMap((name) => {
    const source = definitions.get(name)
    return source ? [[name, { ...source }]] : []
  }))
}

function interfaceName(port: BlockPort): string | undefined {
  return port.type?.match(/^(.+)\.(?:master|slave)$/)?.[1]
}

export function withInterfaceSources(ports: BlockPort[], sources?: Record<string, DefinitionSource>): BlockPort[] {
  return ports.map((port) => {
    const name = interfaceName(port)
    if (!name || port.interfaceSource) return port
    const source = sources?.[name]
    return { ...port, interfaceSource: source ? { ...source } : { path: null, version: null } }
  })
}

export function migrateInterfaceSources(data: BlockData): BlockData {
  return {
    ...data,
    ports: withInterfaceSources(data.ports, data.interfaceSources),
    ...(data.portDefinitions ? { portDefinitions: withInterfaceSources(data.portDefinitions, data.interfaceSources) } : {}),
  }
}

export function designDefinitions(nodes: BlockNode[]): DesignDefinitions {
  const blocks: DesignDefinitions['blocks'] = []
  const interfaces: DesignDefinitions['interfaces'] = []
  const blockKeys = new Set<string>()
  const interfaceKeys = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'block') {
      const { kind, definitionSource } = node.data
      const entry = { kind, path: definitionSource?.path ?? null, version: definitionSource?.version ?? null }
      const key = JSON.stringify([entry.kind, entry.path, entry.version])
      if (!blockKeys.has(key)) { blockKeys.add(key); blocks.push(entry) }
    }
    const addInterface = (name: string, source?: InterfaceSource) => {
      const entry = { name, path: source?.path ?? null, version: source?.version ?? null }
      const key = JSON.stringify([entry.name, entry.path, entry.version])
      if (!interfaceKeys.has(key)) { interfaceKeys.add(key); interfaces.push(entry) }
    }
    const ports = withInterfaceSources([...(node.data.portDefinitions ?? []), ...node.data.ports], node.data.interfaceSources)
    const names = new Set<string>()
    for (const port of ports) {
      const name = interfaceName(port)
      if (name) { names.add(name); addInterface(name, port.interfaceSource) }
    }
    const bus = node.data.bus
    if (bus && !names.has(bus.interface)) addInterface(bus.interface, node.data.interfaceSources?.[bus.interface])
  }
  return { interfaces, blocks }
}
