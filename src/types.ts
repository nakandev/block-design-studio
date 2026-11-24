export type PortDirection = 'input' | 'output'
export type InterfacePortType = `${string}.master` | `${string}.slave`
export type SignalPortType = 'clock' | 'reset'
export type BlockPortType = InterfacePortType | SignalPortType

export interface BlockPort {
  id: string
  name: string
  direction: PortDirection
  width?: number
  type?: BlockPortType
}

export interface InterfaceDefinition {
  name: string
  label: string
}

export interface AddressMapEntry {
  portId: string
  baseAddress: string | null
  size: string | null
}

export interface LegacyAddressMap {
  addressWidth: 32 | 64
  entries: AddressMapEntry[]
}

export interface AddressMapGroup {
  slavePortId: string
  entries: AddressMapEntry[]
}

export interface GroupedAddressMap {
  addressWidth: 32 | 64
  groups: AddressMapGroup[]
}

export type AddressMap = LegacyAddressMap | GroupedAddressMap

export interface BlockTemplate {
  kind: string
  label: string
  ports: BlockPort[]
}

export interface BlockData extends Record<string, unknown> {
  label: string
  kind: string
  ports: BlockPort[]
  parameters: Record<string, string | number | boolean>
  addressMap?: AddressMap
}

export interface DesignDocument {
  version: 1
  name: string
  nodes: unknown[]
  edges: unknown[]
}
