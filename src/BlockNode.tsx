import { useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData, BlockPort } from './types'

export type BlockNode = Node<BlockData, string>

function portClass(port: BlockPort): string {
  if (port.type === 'clock') return ' clock-handle'
  if (port.type === 'reset') return ' reset-handle'
  return port.type ? ' interface-handle' : ''
}

function PortRow({ port, side, horizontal }: { port: BlockPort; side: 'input' | 'output'; horizontal: boolean }) {
  const input = side === 'input'
  return (
    <div className={`port-row ${input ? 'input-row' : 'output-row'}`}>
      <Handle
        type={input ? 'target' : 'source'}
        position={horizontal ? (input ? Position.Top : Position.Bottom) : (input ? Position.Left : Position.Right)}
        id={port.id}
        className={`port-handle ${input ? 'input-handle' : 'output-handle'}${portClass(port)}`}
      />
      <span>{port.name}</span>
      <small>{port.type ?? (port.width !== undefined ? `${port.width}-bit` : '')}</small>
    </div>
  )
}

export default function BlockNodeView({ id, data, selected }: NodeProps<BlockNode>) {
  const updateNodeInternals = useUpdateNodeInternals()
  const horizontal = data.portLayout === 'horizontal'
  useEffect(() => { updateNodeInternals(id) }, [id, data.ports, horizontal, updateNodeInternals])
  const inputs = data.ports.filter((port) => port.direction === 'input')
  const outputs = data.ports.filter((port) => port.direction === 'output')
  return (
    <div className={`block-node${horizontal ? ' horizontal-ports' : ''}${selected ? ' selected' : ''}`}>
      {horizontal && <div className="input-ports">
        {inputs.map((port) => <PortRow key={port.id} port={port} side="input" horizontal />)}
      </div>}
      <div className="block-node-header">
        <span className="block-kind">{data.kind}</span>
        <strong>{data.label}</strong>
      </div>
      {horizontal ? <div className="output-ports">
        {outputs.map((port) => <PortRow key={port.id} port={port} side="output" horizontal />)}
      </div> : <div className="ports">
        <div className="input-ports">{inputs.map((port) => <PortRow key={port.id} port={port} side="input" horizontal={false} />)}</div>
        <div className="output-ports">{outputs.map((port) => <PortRow key={port.id} port={port} side="output" horizontal={false} />)}</div>
      </div>}
    </div>
  )
}
