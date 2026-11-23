import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { BlockData, BlockPort } from './types'

export type BlockNode = Node<BlockData, string>

function portClass(port: BlockPort): string {
  if (port.type === 'clock') return ' clock-handle'
  if (port.type === 'reset') return ' reset-handle'
  return port.type ? ' interface-handle' : ''
}

function PortRow({ port, side }: { port: BlockPort; side: 'input' | 'output' }) {
  const input = side === 'input'
  return <div className={`port-row ${input ? 'input-row' : 'output-row'}`}>
    <Handle type={input ? 'target' : 'source'} position={input ? Position.Left : Position.Right} id={port.id} className={`port-handle ${input ? 'input-handle' : 'output-handle'}${portClass(port)}`} />
    <span>{port.name}</span>
    <small>{port.type ?? (port.width !== undefined ? `${port.width}-bit` : '')}</small>
  </div>
}

export default function BlockNodeView({ data, selected }: NodeProps<BlockNode>) {
  return <div className={`block-node${selected ? ' selected' : ''}`}><div className="block-node-header"><span className="block-kind">{data.kind}</span><strong>{data.label}</strong></div><div class="ports">
    <div className="input-ports">{data.ports.filter((port) => port.direction === 'input').map((port) => <PortRow key={port.id} port={port} side="input" />)}</div>
    <div className="output-ports">{data.ports.filter((port) => port.direction === 'output').map((port) => <PortRow key={port.id} port={port} side="output" />)}</div>
  </div></div>
}
