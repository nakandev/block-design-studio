import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import BlockNodeView, { type BlockNode } from './BlockNode'
import type { BlockData, BlockPort, DesignDocument } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'
const HISTORY_LIMIT = 100
const nodeTypes: NodeTypes = { block: BlockNodeView }

interface Snapshot {
  nodes: BlockNode[]
  edges: Edge[]
}

const blockTemplates: Array<{ kind: string; label: string; ports: BlockPort[] }> = [
  { kind: 'Input', label: 'Input', ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }] },
  { kind: 'Output', label: 'Output', ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }] },
  { kind: 'Arithmetic', label: 'Adder', ports: [
    { id: 'a', name: 'a', direction: 'input', width: 32 },
    { id: 'b', name: 'b', direction: 'input', width: 32 },
    { id: 'sum', name: 'sum', direction: 'output', width: 32 },
  ] },
  { kind: 'Storage', label: 'Register', ports: [
    { id: 'clk', name: 'clk', direction: 'input', width: 1 },
    { id: 'din', name: 'din', direction: 'input', width: 32 },
    { id: 'dout', name: 'dout', direction: 'output', width: 32 },
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

function createInitialNodes(): BlockNode[] {
  return [{
    id: 'input_1', type: 'block', position: { x: 80, y: 180 },
    data: { label: 'Input', kind: 'Input', ports: blockTemplates[0].ports, parameters: {} },
  }]
}

export default function App() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<BlockNode>(createInitialNodes())
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [designName, setDesignName] = useState('untitled')
  const [status, setStatus] = useState('Ready')
  const [historyVersion, setHistoryVersion] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pastRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const dragStartRef = useRef<Snapshot | null>(null)
  const labelEditStartRef = useRef<Snapshot | null>(null)

  nodesRef.current = nodes
  edgesRef.current = edges

  const refreshHistoryState = useCallback(() => setHistoryVersion((version) => version + 1), [])
  const snapshot = useCallback((): Snapshot => ({ nodes: nodesRef.current, edges: edgesRef.current }), [])
  const applyTransition = useCallback((before: Snapshot, after: Snapshot) => {
    if (before.nodes === after.nodes && before.edges === after.edges) return
    pastRef.current = [...pastRef.current, before].slice(-HISTORY_LIMIT)
    futureRef.current = []
    refreshHistoryState()
  }, [refreshHistoryState])
  const replaceDocument = useCallback((nextNodes: BlockNode[], nextEdges: Edge[]) => {
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [setEdges, setNodes])

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1)
    if (!previous) return
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, snapshot()].slice(-HISTORY_LIMIT)
    replaceDocument(previous.nodes, previous.edges)
    setSelectedNodeId(null)
    setStatus('Undo')
    refreshHistoryState()
  }, [refreshHistoryState, replaceDocument, snapshot])

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1)
    if (!next) return
    futureRef.current = futureRef.current.slice(0, -1)
    pastRef.current = [...pastRef.current, snapshot()].slice(-HISTORY_LIMIT)
    replaceDocument(next.nodes, next.edges)
    setSelectedNodeId(null)
    setStatus('Redo')
    refreshHistoryState()
  }, [refreshHistoryState, replaceDocument, snapshot])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  const canUndo = pastRef.current.length > 0
  const canRedo = futureRef.current.length > 0
  void historyVersion
  const selectedNode = nodes.find((node) => node.id === selectedNodeId)

  const onNodesChange = useCallback((changes: NodeChange<BlockNode>[]) => {
    const before = snapshot()
    const nextNodes = applyNodeChanges(changes, nodesRef.current) as BlockNode[]
    nodesRef.current = nextNodes
    onNodesChangeBase(changes)
    if (changes.some((change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) {
      applyTransition(before, { nodes: nextNodes, edges: edgesRef.current })
    }
  }, [applyTransition, onNodesChangeBase, snapshot])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const before = snapshot()
    const nextEdges = applyEdgeChanges(changes, edgesRef.current)
    edgesRef.current = nextEdges
    onEdgesChangeBase(changes)
    if (changes.some((change) => change.type === 'remove')) {
      applyTransition(before, { nodes: nodesRef.current, edges: nextEdges })
    }
  }, [applyTransition, onEdgesChangeBase, snapshot])

  const getConnectionPorts = useCallback((connection: Edge | Connection) => {
    const sourceNode = nodesRef.current.find((node) => node.id === connection.source)
    const targetNode = nodesRef.current.find((node) => node.id === connection.target)
    return {
      sourcePort: sourceNode?.data.ports.find((port) => port.id === connection.sourceHandle),
      targetPort: targetNode?.data.ports.find((port) => port.id === connection.targetHandle),
    }
  }, [])

  const getConnectionError = useCallback((sourcePort?: BlockPort, targetPort?: BlockPort) => {
    if (!sourcePort || !targetPort) return 'Connect valid ports on both blocks'
    if (sourcePort.type || targetPort.type) {
      return sourcePort.type === 'axi.master' && targetPort.type === 'axi.slave'
        ? null
        : 'AXI ports can only connect axi.master to axi.slave'
    }
    if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') {
      return 'Connect an output port to an input port'
    }
    if (sourcePort.width !== targetPort.width) {
      return `Port width mismatch: ${sourcePort.width}-bit output cannot connect to ${targetPort.width}-bit input`
    }
    return null
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const { sourcePort, targetPort } = getConnectionPorts(connection)
    const error = getConnectionError(sourcePort, targetPort)
    if (error) { setStatus(error); return }

    const targetAlreadyConnected = edgesRef.current.some((edge) =>
      edge.target === connection.target && edge.targetHandle === connection.targetHandle,
    )
    if (targetAlreadyConnected) { setStatus('This input port is already connected'); return }

    const before = snapshot()
    const nextEdges = addEdge({ ...connection, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, edgesRef.current)
    edgesRef.current = nextEdges
    setEdges(nextEdges)
    applyTransition(before, { nodes: nodesRef.current, edges: nextEdges })
    setStatus('Connection created')
  }, [applyTransition, getConnectionError, getConnectionPorts, setEdges, snapshot])

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false
    const { sourcePort, targetPort } = getConnectionPorts(connection)
    const error = getConnectionError(sourcePort, targetPort)
    if (error) setStatus(error)
    return error === null
  }, [getConnectionError, getConnectionPorts])

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    setSelectedNodeId(selectedNodes.length === 1 ? selectedNodes[0].id : null)
  }, [])

  const addBlock = useCallback((templateIndex: number) => {
    const before = snapshot()
    const template = blockTemplates[templateIndex]
    const id = `${template.kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`
    const offset = nodesRef.current.length * 24
    const nextNodes = [...nodesRef.current, {
      id, type: 'block', position: { x: 260 + offset, y: 120 + offset },
      data: { label: template.label, kind: template.kind, ports: template.ports.map((port) => ({ ...port })), parameters: {} },
    }] as BlockNode[]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    applyTransition(before, { nodes: nextNodes, edges: edgesRef.current })
    setSelectedNodeId(id)
    setStatus(`${template.label} added`)
  }, [applyTransition, setNodes, snapshot])

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return
    const before = snapshot()
    const nextNodes = nodesRef.current.filter((node) => node.id !== selectedNodeId)
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId)
    replaceDocument(nextNodes, nextEdges)
    applyTransition(before, { nodes: nextNodes, edges: nextEdges })
    setSelectedNodeId(null)
    setStatus('Block deleted')
  }, [applyTransition, replaceDocument, selectedNodeId, snapshot])

  const updateSelectedLabel = useCallback((label: string) => {
    if (!selectedNodeId) return
    const nextNodes = nodesRef.current.map((node) => node.id === selectedNodeId
      ? { ...node, data: { ...node.data, label } } : node) as BlockNode[]
    nodesRef.current = nextNodes
    setNodes(nextNodes)
  }, [selectedNodeId, setNodes])

  const makeDocument = useCallback((): DesignDocument => ({
    version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current,
  }), [designName])

  const saveDocument = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeDocument()))
    setStatus('Saved in browser storage')
  }, [makeDocument])

  const exportDocument = useCallback(() => {
    const blob = new Blob([JSON.stringify(makeDocument(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${designName || 'block-design'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus('JSON exported')
  }, [designName, makeDocument])

  const openDocument = useCallback(async (file: File) => {
    try {
      const document = JSON.parse(await file.text()) as DesignDocument
      if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Unsupported design format')
      const before = snapshot()
      const nextNodes = document.nodes as BlockNode[]
      const nextEdges = document.edges as Edge[]
      replaceDocument(nextNodes, nextEdges)
      applyTransition(before, { nodes: nextNodes, edges: nextEdges })
      setDesignName(document.name || 'untitled')
      setSelectedNodeId(null)
      setStatus('Design opened')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open design') }
  }, [applyTransition, replaceDocument, snapshot])

  const restoreLastSaved = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) { setStatus('No saved design found'); return }
    try {
      const document = JSON.parse(saved) as DesignDocument
      const before = snapshot()
      const nextNodes = document.nodes as BlockNode[]
      const nextEdges = document.edges as Edge[]
      replaceDocument(nextNodes, nextEdges)
      applyTransition(before, { nodes: nextNodes, edges: nextEdges })
      setDesignName(document.name || 'untitled')
      setStatus('Last saved design restored')
    } catch { setStatus('Saved design could not be restored') }
  }, [applyTransition, replaceDocument, snapshot])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">BD</div><strong>Block Design Studio</strong></div>
        <input className="design-name" value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" />
        <div className="top-actions">
          <button className="history-button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">↶</button>
          <button className="history-button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
          <button onClick={restoreLastSaved}>Restore</button><button onClick={saveDocument}>Save</button>
          <button className="primary" onClick={exportDocument}>Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()}>Open</button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void openDocument(file)
            event.target.value = ''
          }} />
        </div>
      </header>

      <div className="workspace">
        <aside className="palette panel">
          <div className="panel-title">Block Library</div>
          {blockTemplates.map((template, index) => (
            <button className="library-item" key={template.kind} onClick={() => addBlock(index)}>
              <span className="library-icon">{template.kind.slice(0, 1)}</span>
              <span><strong>{template.label}</strong><small>{template.kind}</small></span>
            </button>
          ))}
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} isValidConnection={isValidConnection} onSelectionChange={onSelectionChange}
            onNodeDragStart={() => { dragStartRef.current = snapshot() }}
            onNodeDragStop={() => {
              if (!dragStartRef.current) return
              applyTransition(dragStartRef.current, snapshot())
              dragStartRef.current = null
            }}
            fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']} colorMode="light"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls /><MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </section>

        <aside className="properties panel">
          <div className="panel-title">Properties</div>
          {selectedNode ? (
            <div className="property-form">
              <label>Name
                <input value={selectedNode.data.label} onFocus={() => { labelEditStartRef.current = snapshot() }} onChange={(event) => updateSelectedLabel(event.target.value)} onBlur={() => {
                  if (labelEditStartRef.current) { applyTransition(labelEditStartRef.current, snapshot()); labelEditStartRef.current = null }
                }} />
              </label>
              <label>Type<input value={selectedNode.data.kind} readOnly /></label>
              <div className="property-section"><strong>Ports</strong>
                {selectedNode.data.ports.map((port) => (
                  <div className="port-property" key={port.id}>
                    <span>{port.name}</span>
                    <small>{port.type ?? `${port.direction} · ${port.width}-bit`}</small>
                  </div>
                ))}
              </div>
              <button className="danger" onClick={deleteSelected}>Delete block</button>
            </div>
          ) : <p className="empty-state">Select a block to edit its properties.</p>}
        </aside>
      </div>

      <footer className="statusbar">
        <span className={status.includes('mismatch') || status.includes('AXI ports') ? 'status-warning' : undefined} role="status">{status}</span>
        <span>{nodes.length} blocks · {edges.length} connections</span>
      </footer>
    </main>
  )
}
