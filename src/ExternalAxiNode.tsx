import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalInterfaceNode = Node<BlockData, 'externalInterfaceMaster' | 'externalInterfaceSlave'>

export default function ExternalAxiNodeView({ type, data, selected }: NodeProps<ExternalInterfaceNode>) {
  const port = data.ports[0]
  const master = type === 'externalInterfaceMaster'
  const protocol = port?.type?.replace(/\.(master|slave)$/, '') ?? 'interface'
  const label = protocol.toUpperCase()

  return (
    <div className={`external-axi-node external-interface-node ${protocol.toLowerCase()}-node${selected ? ' selected' : ''}`}>
      <div className="external-axi-header">
        <span>External {label} {master ? 'Master' : 'Slave'}</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className={`external-axi-port ${master ? 'master-port' : 'slave-port'}`}>
          <Handle
            type={master ? 'source' : 'target'}
            position={master ? Position.Right : Position.Left}
            id={port.id}
            className={`port-handle external-interface-handle ${protocol.toLowerCase()}-handle`}
          />
          <span>{port.name}</span><small>{port.type}</small>
        </div>
      )}
    </div>
  )
}
