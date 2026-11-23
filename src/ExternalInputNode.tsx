import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalInputNode = Node<BlockData, 'externalInput'>

export default function ExternalInputNodeView({ data, selected }: NodeProps<ExternalInputNode>) {
  const port = data.ports[0]

  return (
    <div className={`external-input-node${selected ? ' selected' : ''}`}>
      <div className="external-input-header">
        <span>External Input</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className="external-input-port">
          <Handle
            type="source"
            position={Position.Right}
            id={port.id}
            className="port-handle external-output-handle"
          />
          <span>{port.name}</span>
          <small>{port.width}-bit</small>
        </div>
      )}
    </div>
  )
}
