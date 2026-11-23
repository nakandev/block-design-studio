export type PortDirection = 'input' | 'output'

export interface BlockPort {
  id: string
  name: string
  direction: PortDirection
  width: number
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
