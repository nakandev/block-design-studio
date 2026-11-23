export type PortDirection = 'input' | 'output'
export type InterfacePortType = 'axi.master' | 'axi.slave'

export interface BlockPort {
  id: string
  name: string
  direction: PortDirection
  /** Omit for interface ports whose compatibility is determined by type. */
  width?: number
  type?: InterfacePortType
}

export interface BlockData {
  label: string
  kind: string
  ports: BlockPort[]
  parameters: Record<string, string | number | boolean>
}

export interface DesignDocument {
  version: 1
  name: string
  nodes: unknown[]
  edges: unknown[]
}
