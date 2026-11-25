import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalSignalNode = Node<BlockData, 'externalClock' | 'externalReset'>

export default function ExternalSignalNodeView({ type, data, selected }: NodeProps<ExternalSignalNode>) {
  const port = data.ports[0]
  const kind = type === 'externalClock' ? 'clock' : 'reset'
  const isOutput = port?.direction === 'input'

  return (
    <div className={`external-signal-node ${kind}-node${selected ? ' selected' : ''}`}>
      <div className="external-signal-header">
        <span>External {kind[0].toUpperCase()}{kind.slice(1)} {isOutput ? 'Output' : 'Input'}</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className={`external-signal-port${isOutput ? ' output-port' : ''}`}>
          <Handle
            type={isOutput ? 'target' : 'source'}
            position={isOutput ? Position.Left : Position.Right}
            id={port.id}
            className={`port-handle ${kind}-handle`}
          />
          <span>{port.name}</span>
          <small>{kind}</small>
        </div>
      )}
    </div>
  )
}
