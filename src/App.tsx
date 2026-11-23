import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import BlockNodeView, { type BlockNode } from './BlockNode'
import ExternalInputNodeView from './ExternalInputNode'
import ExternalOutputNodeView from './ExternalOutputNode'
import ExternalAxiNodeView from './ExternalAxiNode'
import OrthogonalEdge from './OrthogonalEdge'
import type { BlockData, BlockPort, BlockTemplate, DesignDocument, InterfacePortType } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'
const HISTORY_LIMIT = 100

const defaultTemplates: BlockTemplate[] = [
  { kind: 'Input', label: 'Input', ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }] },
  { kind: 'Output', label: 'Output', ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }] },
  { kind: 'Arithmetic', label: 'Adder', ports: [
    { id: 'a', name: 'a', direction: 'input', width: 32 },
    { id: 'b', name: 'b', direction: 'input', width: 32 },
    { id: 'sum', name: 'sum', direction: 'output', width: 32 },
  ] },
  { kind: 'CPU', label: 'CPU', ports: [
    { id: 'clk', name: 'clk', direction: 'input', width: 1 },
    { id: 'imem', name: 'imem', direction: 'output', type: 'axi.master' },
    { id: 'dmem', name: 'dmem', direction: 'output', type: 'axi.master' },
  ] },
  { kind: 'AXI Interconnect', label: 'AXI Interconnect', ports: [
    { id: 'clk', name: 'clk', direction: 'input', width: 1 },
    { id: 's0', name: 's0', direction: 'output', type: 'axi.master' },
    { id: 's1', name: 's1', direction: 'output', type: 'axi.master' },
    { id: 'm0', name: 'm0', direction: 'input', type: 'axi.slave' },
    { id: 'm1', name: 'm1', direction: 'input', type: 'axi.slave' },
  ] },
  { kind: 'AXI_I2C', label: 'AXI_I2C', ports: [
    { id: 'clk', name: 'clk', direction: 'input', width: 1 },
    { id: 'slave', name: 'slave', direction: 'input', type: 'axi.slave' },
  ] },
]

const initialNodes: BlockNode[] = [{
  id: 'input_1', type: 'block', position: { x: 80, y: 180 },
  data: { label: 'Input', kind: 'Input', ports: defaultTemplates[0].ports, parameters: {} },
}]

const nodeTypes: NodeTypes = {
  block: BlockNodeView,
  externalInput: ExternalInputNodeView,
  externalOutput: ExternalOutputNodeView,
  externalAxiMaster: ExternalAxiNodeView,
  externalAxiSlave: ExternalAxiNodeView,
}
const edgeTypes = { orthogonal: OrthogonalEdge }

interface Snapshot { nodes: BlockNode[]; edges: Edge[] }

function validateTemplates(value: unknown): BlockTemplate[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Block definitions must be a non-empty JSON array')
  const kinds = new Set<string>()
  return value.map((entry, templateIndex) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Template ${templateIndex + 1} must be an object`)
    const template = entry as Record<string, unknown>
    if (typeof template.kind !== 'string' || !template.kind.trim()) throw new Error(`Template ${templateIndex + 1} has no valid kind`)
    if (typeof template.label !== 'string' || !template.label.trim()) throw new Error(`Template ${template.kind} has no valid label`)
    if (kinds.has(template.kind)) throw new Error(`Duplicate block kind: ${template.kind}`)
    kinds.add(template.kind)
    if (!Array.isArray(template.ports)) throw new Error(`Template ${template.kind} must define a ports array`)

    const portIds = new Set<string>()
    const ports = template.ports.map((entryPort, portIndex) => {
      if (!entryPort || typeof entryPort !== 'object') throw new Error(`Port ${portIndex + 1} in ${template.kind} must be an object`)
      const port = entryPort as Record<string, unknown>
      if (typeof port.id !== 'string' || !port.id.trim() || typeof port.name !== 'string' || !port.name.trim()) {
        throw new Error(`Port ${portIndex + 1} in ${template.kind} needs an id and name`)
      }
      if (portIds.has(port.id)) throw new Error(`Duplicate port id ${port.id} in ${template.kind}`)
      portIds.add(port.id)

      if (port.type === 'clock' || port.type === 'reset') {
        if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Port ${template.kind}.${port.id} with type ${port.type} needs direction input or output`)
        return { id: port.id, name: port.name, direction: port.direction, type: port.type } as BlockPort
      }
      if (port.type === 'axi.master' || port.type === 'axi.slave') {
        return { id: port.id, name: port.name, direction: port.type === 'axi.master' ? 'output' : 'input', type: port.type } as BlockPort
      }
      if (port.type !== undefined) throw new Error(`Invalid port type ${String(port.type)} on ${template.kind}.${port.id}`)
      if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Invalid direction on ${template.kind}.${port.id}`)
      if (typeof port.width !== 'number' || !Number.isInteger(port.width) || port.width < 1) throw new Error(`Invalid width on ${template.kind}.${port.id}`)
      return { id: port.id, name: port.name, direction: port.direction, width: port.width } as BlockPort
    })
    return { kind: template.kind, label: template.label, ports }
  })
}

export default function App() {
  const [templates, setTemplates] = useState(defaultTemplates)
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<BlockNode>(initialNodes)
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
  const dragStartRef = useRef<Snapshot | null>(null)
  const labelStartRef = useRef<Snapshot | null>(null)

  nodesRef.current = nodes
  edgesRef.current = edges

  const snapshot = useCallback((): Snapshot => ({ nodes: nodesRef.current, edges: edgesRef.current }), [])
  const record = useCallback((before: Snapshot) => {
    if (before.nodes === nodesRef.current && before.edges === edgesRef.current) return
    pastRef.current = [...pastRef.current, before].slice(-HISTORY_LIMIT)
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
    renderHistory((version) => version + 1)
  }, [replace, snapshot])
  const redo = useCallback(() => {
    const next = futureRef.current.pop()
    if (!next) return
    pastRef.current.push(snapshot())
    replace(next.nodes, next.edges)
    setSelectedId(null)
    setStatus('Redo')
    renderHistory((version) => version + 1)
  }, [replace, snapshot])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  const selectedNode = nodes.find((node) => node.id === selectedId)
  const getPorts = useCallback((connection: Edge | Connection) => {
    const sourceNode = nodesRef.current.find((node) => node.id === connection.source)
    const targetNode = nodesRef.current.find((node) => node.id === connection.target)
    return {
      source: sourceNode?.data.ports.find((port) => port.id === connection.sourceHandle),
      target: targetNode?.data.ports.find((port) => port.id === connection.targetHandle),
    }
  }, [])
  const connectionError = useCallback((source?: BlockPort, target?: BlockPort) => {
    if (!source || !target) return 'Connect valid ports'
    if (source.direction !== 'output' || target.direction !== 'input') return 'Connect an output port to an input port'
    if (source.type === 'axi.master' || source.type === 'axi.slave' || target.type === 'axi.master' || target.type === 'axi.slave') {
      return source.type === 'axi.master' && target.type === 'axi.slave' ? null : 'AXI ports can only connect axi.master to axi.slave'
    }
    if (source.type === 'clock' || source.type === 'reset' || target.type === 'clock' || target.type === 'reset') {
      return source.type === target.type ? null : `Type mismatch: ${source.type ?? 'signal'} cannot connect to ${target.type ?? 'signal'}`
    }
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
    if (edgesRef.current.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) {
      setStatus('This input port is already connected')
      return
    }
    const before = snapshot()
    const nextEdges = addEdge({ ...connection, type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed } }, edgesRef.current)
    replace(nodesRef.current, nextEdges)
    record(before)
    setStatus('Connection created')
  }, [connectionError, getPorts, record, replace, snapshot])

  const addBlock = (template: BlockTemplate) => {
    const before = snapshot()
    const id = `${template.kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`
    const node: BlockNode = {
      id, type: 'block', position: { x: 260 + nodesRef.current.length * 24, y: 120 + nodesRef.current.length * 24 },
      data: { label: template.label, kind: template.kind, ports: template.ports.map((port) => ({ ...port })), parameters: {} },
    }
    replace([...nodesRef.current, node], edgesRef.current)
    record(before)
    setSelectedId(id)
    setStatus(`${template.label} added`)
  }

  const addExternal = (kind: 'input' | 'output' | InterfacePortType) => {
    const isAxi = kind === 'axi.master' || kind === 'axi.slave'
    const type = isAxi ? (kind === 'axi.master' ? 'externalAxiMaster' : 'externalAxiSlave') : kind === 'input' ? 'externalInput' : 'externalOutput'
    const label = `external_${kind.replace('.', '_')}`
    const port: BlockPort = isAxi
      ? { id: kind.replace('.', '_'), name: label, direction: kind === 'axi.master' ? 'output' : 'input', type: kind }
      : { id: `external_${kind}`, name: label, direction: kind === 'input' ? 'output' : 'input', width: 1 }
    const before = snapshot()
    const count = nodesRef.current.filter((node) => node.type === type).length
    const node: BlockNode = {
      id: `${type}_${Date.now()}`, type,
      position: { x: kind === 'output' || kind === 'axi.slave' ? 560 : 40, y: 140 + count * 64 },
      data: { label, kind: isAxi ? `External ${kind}` : `External ${kind[0].toUpperCase()}${kind.slice(1)}`, ports: [port], parameters: {} },
    }
    replace([...nodesRef.current, node], edgesRef.current)
    record(before)
    setSelectedId(node.id)
    setStatus(`${node.data.kind} added`)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    const before = snapshot()
    replace(nodesRef.current.filter((node) => node.id !== selectedId), edgesRef.current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId))
    record(before)
    setSelectedId(null)
    setStatus('Node deleted')
  }
  const updateLabel = (label: string) => {
    if (!selectedId) return
    const nextNodes = nodesRef.current.map((node) => node.id === selectedId ? {
      ...node,
      data: { ...node.data, label, ports: node.type?.startsWith('external') ? node.data.ports.map((port) => ({ ...port, name: label })) : node.data.ports },
    } : node) as BlockNode[]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
  }
  const updateWidth = (width: number) => {
    if (!selectedId || !Number.isInteger(width) || width < 1) return
    const nextNodes = nodesRef.current.map((node) => node.id === selectedId ? {
      ...node, data: { ...node.data, ports: node.data.ports.map((port) => ({ ...port, width })) },
    } : node) as BlockNode[]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
  }

  const loadDefinitions = async (file: File) => {
    try {
      const loaded = validateTemplates(JSON.parse(await file.text()))
      setTemplates(loaded)
      setStatus(`${loaded.length} block definitions loaded`)
    } catch (error) { setStatus(error instanceof Error ? `Block definition error: ${error.message}` : 'Could not load block definitions') }
  }
  const openDesign = async (file: File) => {
    try {
      const document = JSON.parse(await file.text()) as DesignDocument
      if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Unsupported design format')
      const before = snapshot()
      const nextNodes = document.nodes as BlockNode[]
      const nextEdges = document.edges as Edge[]
      replace(nextNodes, nextEdges)
      record(before)
      setDesignName(document.name || 'untitled')
      setSelectedId(null)
      setStatus('Design opened')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open design') }
  }
  const saveDesign = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current }))
    setStatus('Saved in browser storage')
  }
  const restoreDesign = () => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) { setStatus('No saved design found'); return }
    try {
      const document = JSON.parse(saved) as DesignDocument
      if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Invalid saved design')
      const before = snapshot()
      replace(document.nodes as BlockNode[], document.edges as Edge[])
      record(before)
      setDesignName(document.name || 'untitled')
      setSelectedId(null)
      setStatus('Last saved design restored')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not restore design') }
  }
  const exportDesign = () => {
    const blob = new Blob([JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${designName || 'block-design'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">BD</div><strong>Block Design Studio</strong></div>
        <input className="design-name" value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" />
        <div className="top-actions">
          <button onClick={undo} disabled={!pastRef.current.length} title="Undo">↶</button>
          <button onClick={redo} disabled={!futureRef.current.length} title="Redo">↷</button>
          <button onClick={() => definitionsFileRef.current?.click()}>Load definitions</button>
          <input ref={definitionsFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadDefinitions(file); event.target.value = '' }} />
          <button onClick={restoreDesign}>Restore</button><button onClick={saveDesign}>Save</button>
          <button className="primary" onClick={exportDesign}>Export JSON</button>
          <button onClick={() => designFileRef.current?.click()}>Open</button>
          <input ref={designFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openDesign(file); event.target.value = '' }} />
        </div>
      </header>
      <div className="workspace">
        <aside className="palette panel">
          <div className="panel-title">External Ports</div>
          <button className="library-item" onClick={() => addExternal('input')}><span className="library-icon">I</span><span><strong>External Input</strong></span></button>
          <button className="library-item" onClick={() => addExternal('output')}><span className="library-icon">O</span><span><strong>External Output</strong></span></button>
          <button className="library-item" onClick={() => addExternal('axi.master')}><span className="library-icon">M</span><span><strong>AXI Master</strong></span></button>
          <button className="library-item" onClick={() => addExternal('axi.slave')}><span className="library-icon">S</span><span><strong>AXI Slave</strong></span></button>
          <div className="panel-title block-library-title">Block Library</div>
          {templates.map((template) => <button className="library-item" key={template.kind} onClick={() => addBlock(template)}><span className="library-icon">{template.kind.slice(0, 1)}</span><span><strong>{template.label}</strong><small>{template.kind}</small></span></button>)}
        </aside>
        <section className="canvas-panel">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={(changes: NodeChange<BlockNode>[]) => {
              const before = snapshot()
              const nextNodes = applyNodeChanges(changes, nodesRef.current) as BlockNode[]
              nodesRef.current = nextNodes
              onNodesChangeBase(changes)
              if (changes.some((change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) record(before)
            }}
            onEdgesChange={(changes: EdgeChange<Edge>[]) => {
              const before = snapshot()
              const nextEdges = applyEdgeChanges(changes, edgesRef.current)
              edgesRef.current = nextEdges
              onEdgesChangeBase(changes)
              if (changes.some((change) => change.type === 'remove')) record(before)
            }}
            onConnect={onConnect} isValidConnection={isValidConnection}
            onSelectionChange={({ nodes: selected }: OnSelectionChangeParams) => setSelectedId(selected.length === 1 ? selected[0].id : null)}
            onNodeDragStart={() => { dragStartRef.current = snapshot() }}
            onNodeDragStop={() => { if (dragStartRef.current) { record(dragStartRef.current); dragStartRef.current = null } }}
            fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} /><Controls /><MiniMap pannable zoomable />
          </ReactFlow>
        </section>
        <aside className="properties panel">
          <div className="panel-title">Properties</div>
          {selectedNode ? <div className="property-form">
            <label>Name<input value={selectedNode.data.label} onFocus={() => { labelStartRef.current = snapshot() }} onChange={(event) => updateLabel(event.target.value)} onBlur={() => { if (labelStartRef.current) { record(labelStartRef.current); labelStartRef.current = null } }} /></label>
            <label>Type<input value={selectedNode.data.kind} readOnly /></label>
            {(selectedNode.type === 'externalInput' || selectedNode.type === 'externalOutput') && <label>Width (bits)<input type="number" min="1" step="1" value={selectedNode.data.ports[0]?.width ?? 1} onFocus={() => { labelStartRef.current = snapshot() }} onChange={(event) => updateWidth(Number(event.target.value))} onBlur={() => { if (labelStartRef.current) { record(labelStartRef.current); labelStartRef.current = null } }} /></label>}
            <div className="property-section"><strong>Ports</strong>{selectedNode.data.ports.map((port) => <div className="port-property" key={port.id}><span>{port.name}</span><small>{port.type ?? `${port.direction}${port.width !== undefined ? ` · ${port.width}-bit` : ''}`}</small></div>)}</div>
            <button className="danger" onClick={deleteSelected}>Delete node</button>
          </div> : <p className="empty-state">Select a node to edit its properties.</p>}
        </aside>
      </div>
      <footer className="statusbar"><span role="status">{status}</span><span>{nodes.length} nodes · {edges.length} connections</span></footer>
    </main>
  )
}
