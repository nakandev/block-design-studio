export type PortDirection = 'input' | 'output'
export type InterfacePortType = `${string}.master` | `${string}.slave`
export type SignalPortType = 'clock' | 'reset'
export type BlockPortType = InterfacePortType | SignalPortType

export interface PortGenerate {
  for?: { index: string; count: number; min: number; max: number }
  if?: { default: boolean }
}

export interface BlockPort {
  id: string
  name: string
  direction: PortDirection
  width?: number
  type?: BlockPortType
  generate?: PortGenerate
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

export interface ParameterSetting {
  type: string
  value: string
}

export type ParameterValue = ParameterSetting | string | number | boolean

export interface DefineValue {
  enabled: boolean
  value: string
}

export interface PortConfig {
  counts: Record<string, number>
  enabled: Record<string, boolean>
}

export interface BlockConfig {
  ports?: PortConfig
}

export interface BusDefinition {
  interface: string
}

export interface BlockTemplate {
  kind: string
  label: string
  ports: BlockPort[]
  parameters?: Record<string, ParameterSetting>
  defines?: Record<string, DefineValue>
  bus?: BusDefinition
}

export interface BlockData extends Record<string, unknown> {
  label: string
  kind: string
  ports: BlockPort[]
  portDefinitions?: BlockPort[]
  config?: BlockConfig
  portCounts?: Record<string, number>
  portEnabled?: Record<string, boolean>
  parameters: Record<string, ParameterValue>
  defines?: Record<string, DefineValue>
  bus?: BusDefinition
  addressMap?: AddressMap
}

export interface DesignDocument {
  version: 1
  name: string
  nodes: unknown[]
  edges: unknown[]
}
