import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalAxiNodeType = 'externalAxiMaster' | 'externalAxiSlave'
export type ExternalAxiNode = Node<BlockData, ExternalAxiNodeType>

export default function ExternalAxiNodeView({ type, data, selected }: NodeProps<ExternalAxiNode>) {
  const isMaster = type === 'externalAxiMaster'
  const port = data.ports[0]

  return (
    <div className={`external-axi-node${selected ? ' selected' : ''}`}>
      <div className="external-axi-header">
        <span>External AXI {isMaster ? 'Master' : 'Slave'}</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className={`external-axi-port ${isMaster ? 'master-port' : 'slave-port'}`}>
          <Handle
            type={isMaster ? 'source' : 'target'}
            position={isMaster ? Position.Right : Position.Left}
            id={port.id}
            className="port-handle external-axi-handle"
          />
          <span>{port.name}</span>
          <small>{port.type}</small>
        </div>
      )}
    </div>
  )
}
