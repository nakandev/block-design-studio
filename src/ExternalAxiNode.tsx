import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalAxiNode = Node<BlockData, 'externalAxiMaster' | 'externalAxiSlave'>

export default function ExternalAxiNodeView({ type, data, selected }: NodeProps<ExternalAxiNode>) {
  const master = type === 'externalAxiMaster'
  const port = data.ports[0]
  return <div className={`external-axi-node${selected ? ' selected' : ''}`}>
    <div className="external-axi-header"><span>External AXI {master ? 'Master' : 'Slave'}</span><strong>{data.label}</strong></div>
    <div className={`external-axi-port ${master ? 'master-port' : 'slave-port'}`}>
      <Handle type={master ? 'source' : 'target'} position={master ? Position.Right : Position.Left} id={port.id} className="port-handle external-axi-handle" />
      <span>{port.name}</span><small>{port.type}</small>
    </div>
  </div>
}
