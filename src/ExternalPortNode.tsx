import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { BlockNode } from './BlockNode'

export default function ExternalPortNodeView({ data, selected }: NodeProps<BlockNode>) {
  const port = data.ports[0]
  if (!port) return <div className="external-port missing">{data.label}</div>
  const source = port.direction === 'output'
  const kind = port.type === 'clock' || port.type === 'reset' ? port.type : port.type ? 'interface' : 'signal'
  const description = [data.kind, port.type ?? (port.width !== undefined ? `${port.width}-bit` : '')].filter(Boolean).join(' · ')

  return <div className={`external-port ${source ? 'source' : 'target'} ${kind}${selected ? ' selected' : ''}`} title={description}>
    <Handle
      type={source ? 'source' : 'target'}
      position={source ? Position.Right : Position.Left}
      id={port.id}
      className="port-handle external-port-handle"
    />
    {!source && <span className="external-port-arrow" aria-hidden="true" />}
    <span className="external-port-name">{data.label}</span>
    {source && <span className="external-port-arrow" aria-hidden="true" />}
  </div>
}
