import type { AddressMap, BlockData, BlockPort, BusDefinition } from './types'

export function validateBus(value: unknown, interfaces: Set<string>, kind: string): BusDefinition | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid bus in ${kind}: expected an object`)
  const bus = value as Record<string, unknown>
  if (typeof bus.interface !== 'string' || !interfaces.has(bus.interface) || Object.keys(bus).some((key) => key !== 'interface')) {
    throw new Error(`Invalid bus in ${kind}: interface must name a defined interface`)
  }
  return { interface: bus.interface }
}

export function getBus(data: BlockData): BusDefinition | undefined {
  return data.bus ?? (data.kind === 'AXI Interconnect' ? { interface: 'axi' } : undefined)
}

export function busPorts(ports: BlockPort[], bus: BusDefinition | undefined) {
  return {
    masters: bus ? ports.filter((port) => port.type === `${bus.interface}.master`) : [],
    slaves: bus ? ports.filter((port) => port.type === `${bus.interface}.slave`) : [],
  }
}

export function createAddressMap(ports: BlockPort[], bus: BusDefinition): AddressMap {
  const { masters, slaves } = busPorts(ports, bus)
  return {
    addressWidth: 32,
    groups: slaves.map((slave) => ({
      slavePortId: slave.id,
      entries: masters.map((master) => ({ portId: master.id, baseAddress: null, size: null })),
    })),
  }
}
