import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalSignalNode = Node<BlockData, 'externalClock' | 'externalReset'>

export default function ExternalSignalNodeView({ type, data, selected }: NodeProps<ExternalSignalNode>) {
  const port = data.ports[0]
  const kind = type === 'externalClock' ? 'clock' : 'reset'

  return (
    <div className={`external-signal-node ${kind}-node${selected ? ' selected' : ''}`}>
      <div className="external-signal-header">
        <span>External {kind[0].toUpperCase()}{kind.slice(1)}</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className="external-signal-port">
          <Handle
            type="source"
            position={Position.Right}
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
