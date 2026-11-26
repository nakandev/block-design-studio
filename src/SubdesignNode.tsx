import { createContext, useContext, useEffect, useMemo } from 'react'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import BlockNodeView, { type BlockNode } from './BlockNode'
import type { Subdesign } from './subdesign'

export interface SubdesignViewState {
  designs: Subdesign[]
  expanded: Set<string>
  toggle: (nodeId: string) => void
}

export const SubdesignViewContext = createContext<SubdesignViewState | null>(null)

export function SubdesignPreview({ design }: { design: Subdesign }) {
  if (!design.nodes.length) return <div className="subdesign-empty">No internal nodes</div>
  const width = 156
  const nodeHeight = (node: BlockNode) => 50 + Math.max(1, node.data.ports.length) * 18
  const margin = 30
  const minX = Math.min(...design.nodes.map((node) => node.position.x)) - margin
  const minY = Math.min(...design.nodes.map((node) => node.position.y)) - margin
  const maxX = Math.max(...design.nodes.map((node) => node.position.x + width)) + margin
  const maxY = Math.max(...design.nodes.map((node) => node.position.y + nodeHeight(node))) + margin
  const byId = new Map(design.nodes.map((node) => [node.id, node]))
  const boundaries = design.nodes.filter((node) => node.type?.startsWith('external'))
  return <svg className="subdesign-preview" role="img" aria-label={`Contents of ${design.name}`} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}>
    {design.edges.map((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source || !target) return null
      const sourceIndex = source.data.ports.findIndex((port) => port.id === edge.sourceHandle)
      const targetIndex = target.data.ports.findIndex((port) => port.id === edge.targetHandle)
      if (sourceIndex < 0 || targetIndex < 0) return null
      return <line key={edge.id} x1={source.position.x + width} y1={source.position.y + 59 + sourceIndex * 18} x2={target.position.x} y2={target.position.y + 59 + targetIndex * 18} className="subdesign-preview-edge" />
    })}
    {design.nodes.map((node) => <g key={node.id} transform={`translate(${node.position.x} ${node.position.y})`}>
      <rect width={width} height={nodeHeight(node)} rx="6" className={`subdesign-preview-box${node.type?.startsWith('external') ? ' subdesign-preview-boundary' : ''}`} />
      <text x="8" y="16" className="subdesign-preview-kind">{node.data.kind}</text>
      <text x="8" y="35" className="subdesign-preview-label">{boundaries.includes(node) ? `#${boundaries.indexOf(node) + 1} ` : ''}{node.data.label}</text>
      {node.data.ports.map((port, index) => <g key={port.id}>
        <circle cx={port.direction === 'input' ? 0 : width} cy={59 + index * 18} r="3" className="subdesign-preview-port" />
        <text x={port.direction === 'input' ? 8 : width - 8} y={63 + index * 18} textAnchor={port.direction === 'input' ? 'start' : 'end'} className="subdesign-preview-kind">{port.name}</text>
      </g>)}
    </g>)}
  </svg>
}

export default function SubdesignNodeView(props: NodeProps<BlockNode>) {
  const context = useContext(SubdesignViewContext)
  const updateNodeInternals = useUpdateNodeInternals()
  const expanded = context?.expanded.has(props.id) ?? false
  const design = context?.designs.find((item) => item.id === props.data.subdesignId)
  const displayData = useMemo(() => {
    if (!expanded || !design) return props.data
    const boundaries = design.nodes.filter((node) => node.type?.startsWith('external'))
    return { ...props.data, ports: props.data.ports.map((port) => {
      const index = boundaries.findIndex((node) => node.id === port.id)
      return index < 0 ? port : { ...port, name: `#${index + 1} ${port.name}` }
    }) }
  }, [design, expanded, props.data])
  useEffect(() => { updateNodeInternals(props.id) }, [expanded, design, props.id, updateNodeInternals])
  return <div className={`subdesign-node${expanded ? ' expanded' : ''}`}>
    <BlockNodeView {...props} data={displayData} />
    <button className="subdesign-toggle nodrag nopan" aria-expanded={expanded} onClick={(event) => {
      event.stopPropagation()
      context?.toggle(props.id)
    }}>{expanded ? 'Collapse' : 'Expand'}</button>
    {expanded && (design ? <SubdesignPreview design={design} /> : <div className="subdesign-empty">Subdesign not found</div>)}
  </div>
}
