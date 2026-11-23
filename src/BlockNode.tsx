import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { BlockData, BlockPort } from './types'

export type BlockNode = Node<BlockData, 'block'>

function PortRow({ port, side }: { port: BlockPort; side: 'input' | 'output' }) {
  const isInput = side === 'input'

  return (
    <div className={`port-row ${isInput ? 'input-row' : 'output-row'}`}>
      <Handle
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        id={port.id}
        className={`port-handle ${isInput ? 'input-handle' : 'output-handle'}${port.type ? ' interface-handle' : ''}`}
      />
      <span>{port.name}</span>
      {port.type
        ? <small className="interface-label">{port.type}</small>
        : port.width !== undefined && <small>{port.width}</small>}
    </div>
  )
}

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
          {inputs.map((port) => <PortRow key={port.id} port={port} side="input" />)}
        </div>
        <div className="output-ports">
          {outputs.map((port) => <PortRow key={port.id} port={port} side="output" />)}
        </div>
      </div>
    </div>
  )
}
