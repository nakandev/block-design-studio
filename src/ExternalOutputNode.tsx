import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData } from './types'

export type ExternalOutputNode = Node<BlockData, 'externalOutput'>

export default function ExternalOutputNodeView({ data, selected }: NodeProps<ExternalOutputNode>) {
  const port = data.ports[0]

  return (
    <div className={`external-output-node${selected ? ' selected' : ''}`}>
      <div className="external-output-header">
        <span>External Output</span>
        <strong>{data.label}</strong>
      </div>
      {port && (
        <div className="external-output-port">
          <Handle
            type="target"
            position={Position.Left}
            id={port.id}
            className="port-handle external-input-handle"
          />
          <span>{port.name}</span>
          <small>{port.width}-bit</small>
        </div>
      )}
    </div>
  )
}
