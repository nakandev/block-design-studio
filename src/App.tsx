import { useCallback, useRef, useState } from 'react'
import {
  addEdge,
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
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import BlockNodeView, { type BlockNode } from './BlockNode'
import type { BlockData, DesignDocument } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'

const nodeTypes: NodeTypes = { block: BlockNodeView }

const blockTemplates: Array<{ kind: string; label: string; ports: BlockData['ports'] }> = [
  {
    kind: 'Input',
    label: 'Input',
    ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }],
  },
  {
    kind: 'Output',
    label: 'Output',
    ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }],
  },
  {
    kind: 'Arithmetic',
    label: 'Adder',
    ports: [
      { id: 'a', name: 'a', direction: 'input', width: 32 },
      { id: 'b', name: 'b', direction: 'input', width: 32 },
      { id: 'sum', name: 'sum', direction: 'output', width: 32 },
    ],
  },
  {
    kind: 'Storage',
    label: 'Register',
    ports: [
      { id: 'clk', name: 'clk', direction: 'input', width: 1 },
      { id: 'din', name: 'din', direction: 'input', width: 32 },
      { id: 'dout', name: 'dout', direction: 'output', width: 32 },
    ],
  },
]

function createInitialNodes(): BlockNode[] {
  return [
    {
      id: 'input_1',
      type: 'block',
      position: { x: 80, y: 180 },
      data: {
        label: 'Input',
        kind: 'Input',
        ports: blockTemplates[0].ports,
        parameters: {},
      },
    },
  ]
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>(createInitialNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [designName, setDesignName] = useState('untitled')
  const [status, setStatus] = useState('Ready')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => {
      const targetAlreadyConnected = currentEdges.some((edge) =>
        edge.target === connection.target && edge.targetHandle === connection.targetHandle,
      )
      if (targetAlreadyConnected) {
        setStatus('This input port is already connected')
        return currentEdges
      }

      setStatus('Connection created')
      return addEdge({
        ...connection,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      }, currentEdges)
    })
  }, [setEdges])

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target) return false
    if (connection.source === connection.target) return false

    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    const sourcePort = sourceNode?.data.ports.find((port) => port.id === connection.sourceHandle)
    const targetPort = targetNode?.data.ports.find((port) => port.id === connection.targetHandle)

    return sourcePort?.direction === 'output' && targetPort?.direction === 'input'
  }, [nodes])

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    setSelectedNodeId(selectedNodes.length === 1 ? selectedNodes[0].id : null)
  }, [])

  const addBlock = useCallback((templateIndex: number) => {
    const template = blockTemplates[templateIndex]
    const id = `${template.kind.toLowerCase()}_${Date.now()}`
    const offset = nodes.length * 24

    setNodes((currentNodes) => [...currentNodes, {
      id,
      type: 'block',
      position: { x: 260 + offset, y: 120 + offset },
      data: {
        label: template.label,
        kind: template.kind,
        ports: template.ports.map((port) => ({ ...port })),
        parameters: {},
      },
    }])
    setSelectedNodeId(id)
    setStatus(`${template.label} added`)
  }, [nodes.length, setNodes])

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId))
    setEdges((currentEdges) => currentEdges.filter((edge) =>
      edge.source !== selectedNodeId && edge.target !== selectedNodeId,
    ))
    setSelectedNodeId(null)
    setStatus('Block deleted')
  }, [selectedNodeId, setEdges, setNodes])

  const updateSelectedLabel = useCallback((label: string) => {
    if (!selectedNodeId) return
    setNodes((currentNodes) => currentNodes.map((node) =>
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, label } }
        : node,
    ))
  }, [selectedNodeId, setNodes])

  const makeDocument = useCallback((): DesignDocument => ({
    version: 1,
    name: designName,
    nodes,
    edges,
  }), [designName, nodes, edges])

  const saveDocument = useCallback(() => {
    const document = makeDocument()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
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
      if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
        throw new Error('Unsupported design format')
      }
      setNodes(document.nodes as BlockNode[])
      setEdges(document.edges as Edge[])
      setDesignName(document.name || 'untitled')
      setSelectedNodeId(null)
      setStatus('Design opened')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open design')
    }
  }, [setEdges, setNodes])

  const restoreLastSaved = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      setStatus('No saved design found')
      return
    }
    try {
      const document = JSON.parse(saved) as DesignDocument
      setNodes(document.nodes as BlockNode[])
      setEdges(document.edges as Edge[])
      setDesignName(document.name || 'untitled')
      setStatus('Last saved design restored')
    } catch {
      setStatus('Saved design could not be restored')
    }
  }, [setEdges, setNodes])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">BD</div>
          <strong>Block Design Studio</strong>
        </div>
        <input
          className="design-name"
          value={designName}
          onChange={(event) => setDesignName(event.target.value)}
          aria-label="Design name"
        />
        <div className="top-actions">
          <button onClick={restoreLastSaved}>Restore</button>
          <button onClick={saveDocument}>Save</button>
          <button className="primary" onClick={exportDocument}>Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()}>Open</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void openDocument(file)
              event.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="palette panel">
          <div className="panel-title">Block Library</div>
          {blockTemplates.map((template, index) => (
            <button
              className="library-item"
              key={template.label}
              onClick={() => addBlock(index)}
            >
              <span className="library-icon">{template.kind.slice(0, 1)}</span>
              <span>
                <strong>{template.label}</strong>
                <small>{template.kind}</small>
              </span>
            </button>
          ))}
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={onSelectionChange}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={['Backspace', 'Delete']}
            colorMode="light"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </section>

        <aside className="properties panel">
          <div className="panel-title">Properties</div>
          {selectedNode ? (
            <div className="property-form">
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(event) => updateSelectedLabel(event.target.value)}
                />
              </label>
              <label>
                Type
                <input value={selectedNode.data.kind} readOnly />
              </label>
              <div className="property-section">
                <strong>Ports</strong>
                {selectedNode.data.ports.map((port) => (
                  <div className="port-property" key={port.id}>
                    <span>{port.name}</span>
                    <small>{port.direction} · {port.width}-bit</small>
                  </div>
                ))}
              </div>
              <button className="danger" onClick={deleteSelected}>Delete block</button>
            </div>
          ) : (
            <p className="empty-state">Select a block to edit its properties.</p>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span>{status}</span>
        <span>{nodes.length} blocks · {edges.length} connections</span>
      </footer>
    </main>
  )
}
