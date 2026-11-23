import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { BlockData } from './types'

export type BlockNode = Node<BlockData, 'block'>

export default function BlockNodeView({ data, selected }: NodeProps<BlockNode>) {
  const inputs = data.ports.filter((port) => port.direction === 'input')
  const outputs = data.ports.filter((port) => port.direction === 'output')

  return (
    <div className={`block-node${selected ? ' selected' : ''}`}>
      <div className="block-node-header">
        <span className="block-kind">{data.kind}</span>
        <strong>{data.label}</strong>
      </div>

      <div className="ports">
        <div className="input-ports">
          {inputs.map((port) => (
            <div className="port-row input-row" key={port.id}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                className="port-handle input-handle"
              />
              <span>{port.name}</span>
              <small>{port.width}</small>
            </div>
          ))}
        </div>

        <div className="output-ports">
          {outputs.map((port) => (
            <div className="port-row output-row" key={port.id}>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className="port-handle output-handle"
              />
              <span>{port.name}</span>
              <small>{port.width}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
