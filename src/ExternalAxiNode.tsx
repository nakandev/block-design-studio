import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalAxiNode = Node<BlockData,
  'externalAxiMaster' | 'externalAxiSlave' | 'externalI2cMaster' | 'externalI2cSlave'
>

export default function ExternalAxiNodeView({ type, data, selected }: NodeProps<ExternalAxiNode>) {
  const i2c = type === 'externalI2cMaster' || type === 'externalI2cSlave'
  const master = type === 'externalAxiMaster' || type === 'externalI2cMaster'
  const protocol = i2c ? 'I2C' : 'AXI'
  const port = data.ports[0]

  return <div className={`external-axi-node${i2c ? ' i2c-node' : ''}${selected ? ' selected' : ''}`}>
    <div className="external-axi-header"><span>External {protocol} {master ? 'Master' : 'Slave'}</span><strong>{data.label}</strong></div>
    {port && <div className={`external-axi-port ${master ? 'master-port' : 'slave-port'}`}>
      <Handle
        type={master ? 'source' : 'target'}
        position={master ? Position.Right : Position.Left}
        id={port.id}
        className={i2c ? 'port-handle external-i2c-handle' : 'port-handle external-axi-handle'}
      />
      <span>{port.name}</span><small>{port.type}</small>
    </div>}
  </div>
}
