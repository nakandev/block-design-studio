export type PortDirection = 'input' | 'output'
export type InterfacePortType = 'axi.master' | 'axi.slave'
export type SignalPortType = 'clock' | 'reset'
export type BlockPortType = InterfacePortType | SignalPortType

export interface BlockPort {
  id: string
  name: string
  direction: PortDirection
  width?: number
  type?: BlockPortType
}

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
}

export interface DesignDocument {
  version: 1
  name: string
  nodes: unknown[]
  edges: unknown[]
}
