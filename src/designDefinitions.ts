import type { BlockNode } from './BlockNode'
import type { BlockPort, DefinitionSource, DesignDefinitions, InterfaceDefinition } from './types'

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
    const portDefinitions = node.data.portDefinitions ?? node.data.ports
    for (const name of usedInterfaces([...portDefinitions, ...node.data.ports], node.data.bus)) {
      const source = node.data.interfaceSources?.[name]
      const entry = { name, path: source?.path ?? null, version: source?.version ?? null }
      const key = JSON.stringify([entry.name, entry.path, entry.version])
      if (!interfaceKeys.has(key)) { interfaceKeys.add(key); interfaces.push(entry) }
    }
  }
  return { interfaces, blocks }
}
