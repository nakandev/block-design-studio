import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Controls,
  MarkerType, MiniMap, ReactFlow, useEdgesState, useNodesState,
  type Connection, type Edge, type EdgeChange, type NodeChange, type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import BlockNodeView, { type BlockNode } from './BlockNode'
import ExternalInputNodeView from './ExternalInputNode'
import ExternalOutputNodeView from './ExternalOutputNode'
import ExternalAxiNodeView from './ExternalAxiNode'
import ExternalSignalNodeView from './ExternalSignalNode'
import OrthogonalEdge from './OrthogonalEdge'
import type { BlockData, BlockPort, BlockTemplate, DesignDocument, InterfaceDefinition, InterfacePortType, SignalPortType } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'
const defaultInterfaces: InterfaceDefinition[] = [
  { name: 'axi', label: 'AXI' },
  { name: 'i2c', label: 'I2C' },
]
const defaultTemplates: BlockTemplate[] = [
  { kind: 'Input', label: 'Input', ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }] },
  { kind: 'Output', label: 'Output', ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }] },
  { kind: 'Arithmetic', label: 'Adder', ports: [{ id: 'a', name: 'a', direction: 'input', width: 32 }, { id: 'b', name: 'b', direction: 'input', width: 32 }, { id: 'sum', name: 'sum', direction: 'output', width: 32 }] },
]
const nodeTypes: NodeTypes = {
  block: BlockNodeView,
  externalInput: ExternalInputNodeView,
  externalOutput: ExternalOutputNodeView,
  externalInterfaceMaster: ExternalAxiNodeView,
  externalInterfaceSlave: ExternalAxiNodeView,
  externalClock: ExternalSignalNodeView,
  externalReset: ExternalSignalNodeView,
}
const edgeTypes = { orthogonal: OrthogonalEdge }
interface Snapshot { nodes: BlockNode[]; edges: Edge[] }
interface DefinitionSet { interfaces: InterfaceDefinition[]; blocks: BlockTemplate[] }

function validateDefinitions(value: unknown): DefinitionSet {
  // Accept the original array format as well as the new { interfaces, blocks } format.
  const document = Array.isArray(value) ? { interfaces: defaultInterfaces, blocks: value } : value
  if (!document || typeof document !== 'object') throw new Error('Definitions must be an object containing interfaces and blocks')
  const raw = document as Record<string, unknown>
  if (!Array.isArray(raw.interfaces) || !Array.isArray(raw.blocks)) throw new Error('Definitions must contain interfaces and blocks arrays')

  const names = new Set<string>()
  const interfaces = raw.interfaces.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Interface ${index + 1} must be an object`)
    const item = entry as Record<string, unknown>
    if (typeof item.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(item.name)) throw new Error(`Interface ${index + 1} needs a valid name (letters, digits, _ or -)`)
    if (names.has(item.name)) throw new Error(`Duplicate interface name: ${item.name}`)
    names.add(item.name)
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.name.toUpperCase()
    return { name: item.name, label }
  })
  if (!interfaces.length) throw new Error('At least one interface must be defined')

  if (!raw.blocks.length) throw new Error('Block definitions must be a non-empty array')
  const kinds = new Set<string>()
  const blocks = raw.blocks.map((entry, templateIndex) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Block ${templateIndex + 1} must be an object`)
    const template = entry as Record<string, unknown>
    if (typeof template.kind !== 'string' || !template.kind.trim()) throw new Error(`Block ${templateIndex + 1} has no valid kind`)
    if (typeof template.label !== 'string' || !template.label.trim()) throw new Error(`Block ${template.kind} has no valid label`)
    if (kinds.has(template.kind)) throw new Error(`Duplicate block kind: ${template.kind}`)
    kinds.add(template.kind)
    if (!Array.isArray(template.ports)) throw new Error(`Block ${template.kind} must define a ports array`)
    const portIds = new Set<string>()
    const ports = template.ports.map((entryPort, portIndex) => {
      if (!entryPort || typeof entryPort !== 'object') throw new Error(`Port ${portIndex + 1} in ${template.kind} must be an object`)
      const port = entryPort as Record<string, unknown>
      if (typeof port.id !== 'string' || !port.id.trim() || typeof port.name !== 'string' || !port.name.trim()) throw new Error(`Port ${portIndex + 1} in ${template.kind} needs an id and name`)
      if (portIds.has(port.id)) throw new Error(`Duplicate port id ${port.id} in ${template.kind}`)
      portIds.add(port.id)
      if (port.type === 'clock' || port.type === 'reset') {
        if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Port ${template.kind}.${port.id} with type ${port.type} needs direction input or output`)
        return { id: port.id, name: port.name, direction: port.direction, type: port.type } as BlockPort
      }
      if (typeof port.type === 'string' && (port.type.endsWith('.master') || port.type.endsWith('.slave'))) {
        const interfaceName = port.type.replace(/\.(master|slave)$/, '')
        if (!names.has(interfaceName)) throw new Error(`Undefined interface ${interfaceName} on ${template.kind}.${port.id}`)
        const direction = port.type.endsWith('.master') ? 'output' : 'input'
        return { id: port.id, name: port.name, direction, type: port.type as InterfacePortType } as BlockPort
      }
      if (port.type !== undefined) throw new Error(`Invalid port type ${String(port.type)} on ${template.kind}.${port.id}`)
      if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Invalid direction on ${template.kind}.${port.id}`)
      if (typeof port.width !== 'number' || !Number.isInteger(port.width) || port.width < 1) throw new Error(`Invalid width on ${template.kind}.${port.id}`)
      return { id: port.id, name: port.name, direction: port.direction, width: port.width } as BlockPort
    })
    return { kind: template.kind, label: template.label, ports }
  })
  return { interfaces, blocks }
}

export default function App() {
  const [templates, setTemplates] = useState(defaultTemplates)
  const [interfaces, setInterfaces] = useState(defaultInterfaces)
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<BlockNode>([{ id: 'input_1', type: 'block', position: { x: 80, y: 180 }, data: { label: 'Input', kind: 'Input', ports: defaultTemplates[0].ports, parameters: {} } }])
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [designName, setDesignName] = useState('untitled')
  const [status, setStatus] = useState('Ready')
  const [, renderHistory] = useState(0)
  const designFileRef = useRef<HTMLInputElement>(null)
  const definitionsFileRef = useRef<HTMLInputElement>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const pastRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  nodesRef.current = nodes
  edgesRef.current = edges

  const snapshot = useCallback((): Snapshot => ({ nodes: nodesRef.current, edges: edgesRef.current }), [])
  const record = useCallback((before: Snapshot) => {
    if (before.nodes === nodesRef.current && before.edges === edgesRef.current) return
    pastRef.current = [...pastRef.current, before].slice(-100)
    futureRef.current = []
    renderHistory((version) => version + 1)
  }, [])
  const replace = useCallback((nextNodes: BlockNode[], nextEdges: Edge[]) => {
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [setEdges, setNodes])
  const undo = useCallback(() => {
    const previous = pastRef.current.pop()
    if (!previous) return
    futureRef.current.push(snapshot())
    replace(previous.nodes, previous.edges)
    setSelectedId(null)
    setStatus('Undo')
  }, [replace, snapshot])
  const redo = useCallback(() => {
    const next = futureRef.current.pop()
    if (!next) return
    pastRef.current.push(snapshot())
    replace(next.nodes, next.edges)
    setSelectedId(null)
    setStatus('Redo')
  }, [replace, snapshot])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  const selectedNode = nodes.find((node) => node.id === selectedId)
  const getPorts = useCallback((connection: Edge | Connection) => {
    const sourceNode = nodesRef.current.find((node) => node.id === connection.source)
    const targetNode = nodesRef.current.find((node) => node.id === connection.target)
    return { source: sourceNode?.data.ports.find((port) => port.id === connection.sourceHandle), target: targetNode?.data.ports.find((port) => port.id === connection.targetHandle) }
  }, [])
  const connectionError = useCallback((source?: BlockPort, target?: BlockPort) => {
    if (!source || !target) return 'Connect valid ports'
    if (source.direction !== 'output' || target.direction !== 'input') return 'Connect an output port to an input port'
    const sourceInterface = source.type?.match(/^(.+)\.master$/)?.[1]
    const targetInterface = target.type?.match(/^(.+)\.slave$/)?.[1]
    if (sourceInterface || targetInterface || source.type?.endsWith('.slave') || target.type?.endsWith('.master')) {
      return sourceInterface && sourceInterface === targetInterface ? null : 'Connect a matching interface master to slave'
    }
    if (source.type === 'clock' || source.type === 'reset' || target.type === 'clock' || target.type === 'reset') return source.type === target.type ? null : `Type mismatch: ${source.type ?? 'signal'} cannot connect to ${target.type ?? 'signal'}`
    return source.width === target.width ? null : `Port width mismatch: ${source.width}-bit output cannot connect to ${target.width}-bit input`
  }, [])
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false
    const { source, target } = getPorts(connection)
    return connectionError(source, target) === null
  }, [connectionError, getPorts])
  const onConnect = useCallback((connection: Connection) => {
    const { source, target } = getPorts(connection)
    const error = connectionError(source, target)
    if (error) { setStatus(error); return }
    if (edgesRef.current.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) { setStatus('This input port is already connected'); return }
    const before = snapshot()
    replace(nodesRef.current, addEdge({ ...connection, type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed } }, edgesRef.current))
    record(before)
    setStatus('Connection created')
  }, [connectionError, getPorts, record, replace, snapshot])

  const addBlock = (template: BlockTemplate) => {
    const before = snapshot()
    const id = `${template.kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`
    const node: BlockNode = { id, type: 'block', position: { x: 260 + nodesRef.current.length * 24, y: 120 + nodesRef.current.length * 24 }, data: { label: template.label, kind: template.kind, ports: template.ports.map((port) => ({ ...port })), parameters: {} } }
    replace([...nodesRef.current, node], edgesRef.current)
    record(before)
    setSelectedId(id)
    setStatus(`${template.label} added`)
  }
  const addExternal = (kind: 'input' | 'output' | 'clock' | 'reset' | InterfacePortType, definition?: InterfaceDefinition, side?: 'master' | 'slave') => {
    const isInterface = !!definition && !!side
    const isSignal = kind === 'clock' || kind === 'reset'
    const isAxi = kind === 'axi.master' || kind === 'axi.slave'
    const nodeType = isInterface ? (side === 'master' ? 'externalInterfaceMaster' : 'externalInterfaceSlave') : isAxi ? 'externalInterfaceMaster' : isSignal ? (kind === 'clock' ? 'externalClock' : 'externalReset') : kind === 'input' ? 'externalInput' : 'externalOutput'
    const interfaceType = isInterface ? `${definition.name}.${side}` : kind
    const label = `external_${isInterface ? `${definition.name}_${side}` : kind.replace('.', '_')}`
    const port: BlockPort = isInterface || isAxi
      ? { id: interfaceType, name: label, direction: interfaceType.endsWith('.master') ? 'output' : 'input', type: interfaceType as InterfacePortType }
      : isSignal ? { id: kind, name: label, direction: 'output', type: kind }
      : { id: `external_${kind}`, name: label, direction: kind === 'input' ? 'output' : 'input', width: 1 }
    const before = snapshot()
    const count = nodesRef.current.filter((node) => node.type === nodeType).length
    const id = `${nodeType}_${Date.now()}_${count}`
    const display = isInterface ? `${definition.label} ${side}` : isAxi ? `AXI ${kind.endsWith('master') ? 'master' : 'slave'}` : isSignal ? kind : kind
    const node: BlockNode = { id, type: nodeType, position: { x: isInterface && side === 'slave' ? 560 : 40, y: 140 + count * 64 }, data: { label, kind: `External ${display}`, ports: [port], parameters: {} } }
    replace([...nodesRef.current, node], edgesRef.current)
    record(before)
    setSelectedId(id)
    setStatus(`${node.data.kind} added`)
  }
  const deleteSelected = () => {
    if (!selectedId) return
    const before = snapshot()
    replace(nodesRef.current.filter((node) => node.id !== selectedId), edgesRef.current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId))
    record(before); setSelectedId(null); setStatus('Node deleted')
  }
  const updateLabel = (label: string) => {
    if (!selectedId) return
    const next = nodesRef.current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, label, ports: node.type?.startsWith('external') ? node.data.ports.map((port) => ({ ...port, name: label })) : node.data.ports } } : node) as BlockNode[]
    nodesRef.current = next; setNodes(next)
  }
  const updateWidth = (width: number) => {
    if (!selectedId || !Number.isInteger(width) || width < 1) return
    const next = nodesRef.current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ports: node.data.ports.map((port) => ({ ...port, width })) } } : node) as BlockNode[]
    nodesRef.current = next; setNodes(next)
  }

  const loadDefinitions = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const definitions = validateDefinitions(parsed)
      setTemplates(definitions.blocks)
      setInterfaces(definitions.interfaces)
      setStatus(`${definitions.blocks.length} blocks and ${definitions.interfaces.length} interfaces loaded`)
    } catch (error) {
      setStatus(error instanceof Error ? `Definition error: ${error.message}` : 'Could not load definitions')
    }
  }
  const openDesign = async (file: File) => {
    try {
      const document = JSON.parse(await file.text()) as DesignDocument
      if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Unsupported design format')
      replace(document.nodes as BlockNode[], document.edges as Edge[])
      setDesignName(document.name || 'untitled'); setSelectedId(null); setStatus('Design opened')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open design') }
  }
  const saveDesign = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current })); setStatus('Saved in browser storage') }
  const exportDesign = () => {
    const blob = new Blob([JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${designName || 'block-design'}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">BD</div><strong>Block Design Studio</strong></div>
      <input className="design-name" value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" />
      <div className="top-actions">
        <button onClick={undo} disabled={!pastRef.current.length} title="Undo">↶</button><button onClick={redo} disabled={!futureRef.current.length} title="Redo">↷</button>
        <button onClick={() => definitionsFileRef.current?.click()}>Load definitions</button>
        <input ref={definitionsFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadDefinitions(file); event.target.value = '' }} />
        <button onClick={saveDesign}>Save</button><button className="primary" onClick={exportDesign}>Export JSON</button>
        <button onClick={() => designFileRef.current?.click()}>Open</button>
        <input ref={designFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openDesign(file); event.target.value = '' }} />
      </div>
    </header>
    <div className="workspace">
      <aside className="palette panel">
        <div className="panel-title">External Ports</div>
        <button className="library-item" onClick={() => addExternal('input')}><span className="library-icon">I</span><span><strong>External Input</strong></span></button>
        <button className="library-item" onClick={() => addExternal('output')}><span className="library-icon">O</span><span><strong>External Output</strong></span></button>
        <button className="library-item" onClick={() => addExternal('clock')}><span className="library-icon">C</span><span><strong>External Clock</strong></span></button>
        <button className="library-item" onClick={() => addExternal('reset')}><span className="library-icon">R</span><span><strong>External Reset</strong></span></button>
        {interfaces.map((definition) => <div key={definition.name} className="interface-library-group">
          <div className="interface-library-label">{definition.label}</div>
          <button className="library-item" onClick={() => addExternal('input', definition, 'master')}><span className="library-icon">M</span><span><strong>{definition.label} Master</strong></span></button>
          <button className="library-item" onClick={() => addExternal('input', definition, 'slave')}><span className="library-icon">S</span><span><strong>{definition.label} Slave</strong></span></button>
        </div>)}
        <div className="panel-title block-library-title">Block Library</div>
        {templates.map((template) => <button className="library-item" key={template.kind} onClick={() => addBlock(template)}><span className="library-icon">{template.kind.slice(0, 1)}</span><span><strong>{template.label}</strong><small>{template.kind}</small></span></button>)}
      </aside>
      <section className="canvas-panel">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={(changes: NodeChange<BlockNode>[]) => { const before = snapshot(); const next = applyNodeChanges(changes, nodesRef.current) as BlockNode[]; nodesRef.current = next; onNodesChangeBase(changes); if (changes.some((change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) record(before) }}
          onEdgesChange={(changes: EdgeChange<Edge>[]) => { const before = snapshot(); const next = applyEdgeChanges(changes, edgesRef.current); edgesRef.current = next; onEdgesChangeBase(changes); if (changes.some((change) => change.type === 'remove')) record(before) }}
          onConnect={onConnect} isValidConnection={isValidConnection}
          onSelectionChange={({ nodes: selected }: OnSelectionChangeParams) => setSelectedId(selected.length === 1 ? selected[0].id : null)}
          fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']}>
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} /><Controls /><MiniMap pannable zoomable />
        </ReactFlow>
      </section>
      <aside className="properties panel"><div className="panel-title">Properties</div>{selectedNode ? <div className="property-form">
        <label>Name<input value={selectedNode.data.label} onChange={(event) => updateLabel(event.target.value)} /></label>
        <label>Type<input value={selectedNode.data.kind} readOnly /></label>
        {(selectedNode.type === 'externalInput' || selectedNode.type === 'externalOutput') && <label>Width (bits)<input type="number" min="1" step="1" value={selectedNode.data.ports[0]?.width ?? 1} onChange={(event) => updateWidth(Number(event.target.value))} /></label>}
        <div className="property-section"><strong>Ports</strong>{selectedNode.data.ports.map((port) => <div className="port-property" key={port.id}><span>{port.name}</span><small>{port.type ?? (port.width !== undefined ? `${port.direction} · ${port.width}-bit` : port.direction)}</small></div>)}</div>
        <button className="danger" onClick={deleteSelected}>Delete node</button>
      </div> : <p className="empty-state">Select a node to edit its properties.</p>}</aside>
    </div>
    <footer className="statusbar"><span role="status">{status}</span><span>{nodes.length} nodes · {edges.length} connections</span></footer>
  </main>
}
