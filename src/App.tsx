import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import AddressMapEditor from './AddressMapEditor'
import OrthogonalEdge from './OrthogonalEdge'
import type { AddressMap, BlockPort, BlockTemplate, DesignDocument, InterfacePortType, InterfaceDefinition } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'
const defaultInterfaces: InterfaceDefinition[] = [{ name: 'axi', label: 'AXI' }, { name: 'i2c', label: 'I2C' }]
const defaultTemplates: BlockTemplate[] = [
  { kind: 'Input', label: 'Input', ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }] },
  { kind: 'Output', label: 'Output', ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }] },
  { kind: 'Arithmetic', label: 'Adder', ports: [{ id: 'a', name: 'a', direction: 'input', width: 32 }, { id: 'b', name: 'b', direction: 'input', width: 32 }, { id: 'sum', name: 'sum', direction: 'output', width: 32 }] },
  { kind: 'CPU', label: 'CPU', ports: [{ id: 'clk', name: 'clk', direction: 'input', type: 'clock' }, { id: 'rst', name: 'rst', direction: 'input', type: 'reset' }, { id: 'imem', name: 'imem', direction: 'output', type: 'axi.master' }, { id: 'dmem', name: 'dmem', direction: 'output', type: 'axi.master' }] },
  { kind: 'AXI Interconnect', label: 'AXI Interconnect', ports: [{ id: 'clk', name: 'clk', direction: 'input', type: 'clock' }, { id: 's0', name: 's0', direction: 'output', type: 'axi.master' }, { id: 's1', name: 's1', direction: 'output', type: 'axi.master' }, { id: 'm0', name: 'm0', direction: 'input', type: 'axi.slave' }, { id: 'm1', name: 'm1', direction: 'input', type: 'axi.slave' }] },
]

const nodeTypes: NodeTypes = {
  block: BlockNodeView,
  externalInput: ExternalInputNodeView,
  externalOutput: ExternalOutputNodeView,
  externalInterfaceMaster: ExternalAxiNodeView,
  externalInterfaceSlave: ExternalAxiNodeView,
  externalAxiMaster: ExternalAxiNodeView,
  externalAxiSlave: ExternalAxiNodeView,
  externalI2cMaster: ExternalAxiNodeView,
  externalI2cSlave: ExternalAxiNodeView,
  externalClock: ExternalSignalNodeView,
  externalReset: ExternalSignalNodeView,
}
const edgeTypes = { orthogonal: OrthogonalEdge }
interface Snapshot { nodes: BlockNode[]; edges: Edge[] }
interface DefinitionSet { interfaces: InterfaceDefinition[]; blocks: BlockTemplate[] }

function edgeTypeKey(edge: Edge, nodesById: Map<string, BlockNode>): string {
  const source = nodesById.get(edge.source)?.data.ports.find((port) => port.id === edge.sourceHandle)
  const target = nodesById.get(edge.target)?.data.ports.find((port) => port.id === edge.targetHandle)
  const port = source ?? target
  if (!port) return 'unknown'
  if (!port.type) return 'data'
  const interfaceName = port.type.match(/^(.+)\.(master|slave)$/)?.[1]
  return interfaceName ? `interface:${interfaceName}` : port.type
}

function validateDefinitions(value: unknown): DefinitionSet {
  const document = Array.isArray(value) ? { interfaces: defaultInterfaces, blocks: value } : value
  if (!document || typeof document !== 'object') throw new Error('Definitions must be an object containing interfaces and blocks')
  const raw = document as Record<string, unknown>
  if (!Array.isArray(raw.interfaces) || !Array.isArray(raw.blocks)) throw new Error('Definitions must contain interfaces and blocks arrays')
  const names = new Set<string>()
  const interfaces = raw.interfaces.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Interface ${index + 1} must be an object`)
    const item = entry as Record<string, unknown>
    if (typeof item.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(item.name)) throw new Error(`Interface ${index + 1} needs a valid name`)
    if (names.has(item.name)) throw new Error(`Duplicate interface name: ${item.name}`)
    names.add(item.name)
    return { name: item.name, label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.name.toUpperCase() }
  })
  if (!interfaces.length) throw new Error('At least one interface must be defined')
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
        if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Invalid direction on ${template.kind}.${port.id}`)
        return { id: port.id, name: port.name, direction: port.direction, type: port.type } as BlockPort
      }
      if (typeof port.type === 'string' && /\.(master|slave)$/.test(port.type)) {
        const interfaceName = port.type.replace(/\.(master|slave)$/, '')
        if (!names.has(interfaceName)) throw new Error(`Undefined interface ${interfaceName} on ${template.kind}.${port.id}`)
        return { id: port.id, name: port.name, direction: port.type.endsWith('.master') ? 'output' : 'input', type: port.type } as BlockPort
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
  const [addressMapNodeId, setAddressMapNodeId] = useState<string | null>(null)
  const [designName, setDesignName] = useState('untitled')
  const [status, setStatus] = useState('Ready')
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(() => new Set())
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
    renderHistory((v) => v + 1)
  }, [])
  const replace = useCallback((nextNodes: BlockNode[], nextEdges: Edge[]) => { nodesRef.current = nextNodes; edgesRef.current = nextEdges; setNodes(nextNodes); setEdges(nextEdges) }, [setEdges, setNodes])
  const undo = useCallback(() => { const previous = pastRef.current.pop(); if (!previous) return; futureRef.current.push(snapshot()); replace(previous.nodes, previous.edges); setSelectedId(null); setStatus('Undo') }, [replace, snapshot])
  const redo = useCallback(() => { const next = futureRef.current.pop(); if (!next) return; pastRef.current.push(snapshot()); replace(next.nodes, next.edges); setSelectedId(null); setStatus('Redo') }, [replace, snapshot])

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
  const isAxiInterconnect = selectedNode?.data.kind === 'AXI Interconnect'
  const masterPorts = selectedNode?.data.ports.filter((port) => port.type === 'axi.master') ?? []
  const edgeTypesById = useMemo(() => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    return new Map(edges.map((edge) => [edge.id, edgeTypeKey(edge, nodesById)]))
  }, [nodes, edges])
  const edgeTypeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const key of edgeTypesById.values()) counts.set(key, (counts.get(key) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [edgeTypesById])
  const displayedEdges = useMemo(() => edges.map((edge) => {
    const hidden = hiddenEdgeTypes.has(edgeTypesById.get(edge.id) ?? 'unknown')
    return hidden ? { ...edge, hidden: true, selected: false } : edge
  }), [edges, edgeTypesById, hiddenEdgeTypes])

  const edgeTypeLabel = (key: string) => {
    if (key.startsWith('interface:')) {
      const name = key.slice('interface:'.length)
      return interfaces.find((definition) => definition.name === name)?.label ?? name.toUpperCase()
    }
    return key === 'data' ? 'Data' : key === 'clock' ? 'Clock' : key === 'reset' ? 'Reset' : 'Unknown'
  }

  const getNodesById = useCallback((connection: Edge | Connection) => {
    const sourceNode = nodesRef.current.find((node) => node.id === connection.source)
    const targetNode = nodesRef.current.find((node) => node.id === connection.target)
    return { sourceNode, targetNode }
  }, [])
  const getPorts = useCallback((connection: Edge | Connection) => {
    const { sourceNode, targetNode } = getNodesById(connection)
    return {
      source: sourceNode?.data.ports.find((port) => port.id === connection.sourceHandle),
      target: targetNode?.data.ports.find((port) => port.id === connection.targetHandle),
    }
  }, [getNodesById])

  const connectionError = useCallback((source?: BlockPort, target?: BlockPort, sourceNode?: BlockNode, targetNode?: BlockNode) => {
    if (!source || !target) return 'Connect valid ports'
    if (source.direction !== 'output' || target.direction !== 'input') return 'Connect an output port to an input port'

    const sourceIsExternal = !!sourceNode?.type?.startsWith('external')
    const targetIsExternal = !!targetNode?.type?.startsWith('external')

    const sourceInterface = source.type?.match(/^(.+)\.(master|slave)$/)
    const targetInterface = target.type?.match(/^(.+)\.(master|slave)$/)
    if (sourceInterface || targetInterface) {
      if (!sourceInterface || !targetInterface || sourceInterface[1] !== targetInterface[1]) return 'Interface type mismatch'
      const sourceRole = sourceInterface[2]
      const targetRole = targetInterface[2]
      // External ports are seen from outside the design: master is a target, slave is a source.
      if (sourceIsExternal && targetIsExternal) return sourceRole === 'slave' && targetRole === 'master' ? null : 'Connect an external slave to an external master'
      if (sourceIsExternal || targetIsExternal) return sourceRole === targetRole ? null : 'Connect an external port to a block port with the same role'
      return sourceRole === 'master' && targetRole === 'slave' ? null : 'Connect a matching interface master to slave'
    }
    if (source.type || target.type) {
      return source.type === target.type ? null : `Type mismatch: ${source.type ?? 'signal'} cannot connect to ${target.type ?? 'signal'}`
    }
    return source.width === target.width ? null : `Port width mismatch: ${source.width}-bit output cannot connect to ${target.width}-bit input`
  }, [])

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false
    const { sourceNode, targetNode } = getNodesById(connection)
    const { source, target } = getPorts(connection)
    return connectionError(source, target, sourceNode, targetNode) === null
  }, [connectionError, getNodesById, getPorts])

  const onConnect = useCallback((connection: Connection) => {
    const { sourceNode, targetNode } = getNodesById(connection)
    const { source, target } = getPorts(connection)
    const error = connectionError(source, target, sourceNode, targetNode)
    if (error) { setStatus(error); return }
    if (edgesRef.current.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) { setStatus('This input port is already connected'); return }
    const before = snapshot()
    replace(nodesRef.current, addEdge({ ...connection, type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed } }, edgesRef.current))
    record(before)
    setStatus('Connection created')
  }, [connectionError, getNodesById, getPorts, record, replace, snapshot])

  const addBlock = (template: BlockTemplate) => {
    const before = snapshot()
    const id = `${template.kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`
    const addressMap: AddressMap | undefined = template.kind === 'AXI Interconnect'
      ? { addressWidth: 32, entries: template.ports.filter((port) => port.type === 'axi.master').map((port) => ({ portId: port.id, baseAddress: null, size: null })) }
      : undefined
    const newNode: BlockNode = { id, type: 'block', position: { x: 260 + nodesRef.current.length * 24, y: 120 + nodesRef.current.length * 24 }, data: { label: template.label, kind: template.kind, ports: template.ports.map((port) => ({ ...port })), parameters: {}, ...(addressMap ? { addressMap } : {}) } }
    replace([...nodesRef.current, newNode], edgesRef.current)
    record(before); setSelectedId(id); setStatus(`${template.label} added`)
  }

  const addExternal = (kind: 'input' | 'output' | 'clock' | 'reset' | InterfacePortType, definition?: InterfaceDefinition, side?: 'master' | 'slave') => {
    const isInterface = !!definition && !!side
    const isSignal = kind === 'clock' || kind === 'reset'
    const isAxi = kind === 'axi.master' || kind === 'axi.slave'
    const isI2c = kind === 'i2c.master' || kind === 'i2c.slave'
    const nodeType = isInterface ? (side === 'master' ? 'externalInterfaceMaster' : 'externalInterfaceSlave') : isAxi ? (kind === 'axi.master' ? 'externalAxiMaster' : 'externalAxiSlave') : isI2c ? (kind === 'i2c.master' ? 'externalI2cMaster' : 'externalI2cSlave') : isSignal ? (kind === 'clock' ? 'externalClock' : 'externalReset') : kind === 'input' ? 'externalInput' : 'externalOutput'
    const interfaceType = isInterface ? `${definition.name}.${side}` : kind
    const label = `external_${isInterface ? `${definition.name}_${side}` : kind.replace('.', '_')}`
    const port: BlockPort = isInterface || isAxi || isI2c
      ? { id: interfaceType.replace('.', '_'), name: label, direction: interfaceType.endsWith('.master') ? 'input' : 'output', type: interfaceType as InterfacePortType }
      : isSignal ? { id: kind, name: label, direction: 'output', type: kind }
      : { id: `external_${kind}`, name: label, direction: kind === 'input' ? 'output' : 'input', width: 1 }
    const before = snapshot()
    const count = nodesRef.current.filter((node) => node.type === nodeType).length
    const id = `${nodeType}_${Date.now()}_${count}`
    const display = isInterface ? `${definition.label} ${side}` : isAxi || isI2c ? kind : `External ${kind[0].toUpperCase()}${kind.slice(1)}`
    const newNode: BlockNode = { id, type: nodeType, position: { x: interfaceType.endsWith('.master') ? 560 : 40, y: 140 + count * 64 }, data: { label, kind: `External ${display}`, ports: [port], parameters: {} } }
    replace([...nodesRef.current, newNode], edgesRef.current)
    record(before); setSelectedId(id); setStatus(`${newNode.data.kind} added`)
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
  const applyAddressMap = (addressMap: AddressMap) => {
    if (!addressMapNodeId) return
    const before = snapshot()
    const next = nodesRef.current.map((node) => node.id === addressMapNodeId ? { ...node, data: { ...node.data, addressMap } } : node) as BlockNode[]
    replace(next, edgesRef.current); record(before); setAddressMapNodeId(null); setStatus('Address map saved')
  }

  const loadDefinitions = async (file: File) => {
    try { const parsed = validateDefinitions(JSON.parse(await file.text())); setTemplates(parsed.blocks); setInterfaces(parsed.interfaces); setStatus(`${parsed.blocks.length} blocks and ${parsed.interfaces.length} interfaces loaded`) }
    catch (error) { setStatus(error instanceof Error ? `Definition error: ${error.message}` : 'Could not load definitions') }
  }
  const openDesign = async (file: File) => {
    try { const document = JSON.parse(await file.text()) as DesignDocument; if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Unsupported design format'); replace(document.nodes as BlockNode[], document.edges as Edge[]); setDesignName(document.name || 'untitled'); setSelectedId(null); setStatus('Design opened') }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open design') }
  }
  const saveDesign = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current })); setStatus('Saved in browser storage') }
  const exportDesign = () => { const blob = new Blob([JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${designName || 'block-design'}.json`; anchor.click(); URL.revokeObjectURL(url) }

  const addressMapNode = nodes.find((node) => node.id === addressMapNodeId)
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">BD</div><strong>Block Design Studio</strong></div><input className="design-name" value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" /><div className="top-actions"><button onClick={undo} disabled={!pastRef.current.length} title="Undo">↶</button><button onClick={redo} disabled={!futureRef.current.length} title="Redo">↷</button><button onClick={() => definitionsFileRef.current?.click()}>Load definitions</button><input ref={definitionsFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadDefinitions(file); event.target.value = '' }} /><button onClick={saveDesign}>Save</button><button className="primary" onClick={exportDesign}>Export JSON</button><button onClick={() => designFileRef.current?.click()}>Open</button><input ref={designFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openDesign(file); event.target.value = '' }} /></div></header>
    <div className="workspace">
      <aside className="sidebar panel">
        <details className="wire-filter" open>
          <summary className="panel-title">Wire visibility</summary>
          <div className="wire-filter-content">
            <div className="wire-filter-actions">
              <button onClick={() => setHiddenEdgeTypes(new Set())}>Show all</button>
              <button onClick={() => setHiddenEdgeTypes(new Set(edgeTypeCounts.map(([key]) => key)))}>Hide all</button>
            </div>
            {edgeTypeCounts.length === 0 && <p className="empty-state">No connections yet.</p>}
            {edgeTypeCounts.map(([key, count]) => <label className="wire-filter-item" key={key}>
              <input type="checkbox" checked={!hiddenEdgeTypes.has(key)} onChange={(event) => {
                const checked = event.target.checked
                setHiddenEdgeTypes((previous) => {
                  const next = new Set(previous)
                  if (checked) next.delete(key); else next.add(key)
                  return next
                })
              }} />
              <span>{edgeTypeLabel(key)}</span><small>{count}</small>
            </label>)}
          </div>
        </details>
        <div className="palette"><div className="panel-title">External Ports</div><button className="library-item" onClick={() => addExternal('input')}><span className="library-icon">I</span><strong>External Input</strong></button><button className="library-item" onClick={() => addExternal('output')}><span className="library-icon">O</span><strong>External Output</strong></button><button className="library-item" onClick={() => addExternal('clock')}><span className="library-icon">C</span><strong>External Clock</strong></button><button className="library-item" onClick={() => addExternal('reset')}><span className="library-icon">R</span><strong>External Reset</strong></button>{interfaces.map((definition) => <div key={definition.name} className="interface-library-group"><div className="interface-library-label">{definition.label}</div><button className="library-item" onClick={() => addExternal('input', definition, 'master')}><span className="library-icon">M</span><strong>{definition.label} Master</strong></button><button className="library-item" onClick={() => addExternal('input', definition, 'slave')}><span className="library-icon">S</span><strong>{definition.label} Slave</strong></button></div>)}<div className="panel-title block-library-title">Block Library</div>{templates.map((template) => <button className="library-item" key={template.kind} onClick={() => addBlock(template)}><span className="library-icon">{template.kind.slice(0, 1)}</span><span><strong>{template.label}</strong><small>{template.kind}</small></span></button>)}</div>
      </aside>
      <section className="canvas-panel"><ReactFlow nodes={nodes} edges={displayedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={(changes: NodeChange<BlockNode>[]) => { const before = snapshot(); const next = applyNodeChanges(changes, nodesRef.current) as BlockNode[]; nodesRef.current = next; onNodesChangeBase(changes); if (changes.some((change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) record(before) }} onEdgesChange={(changes: EdgeChange<Edge>[]) => { const before = snapshot(); const next = applyEdgeChanges(changes, edgesRef.current); edgesRef.current = next; onEdgesChangeBase(changes); if (changes.some((change) => change.type === 'remove')) record(before) }} onConnect={onConnect} isValidConnection={isValidConnection} onSelectionChange={({ nodes: selected }: OnSelectionChangeParams) => setSelectedId(selected.length === 1 ? selected[0].id : null)} fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']}><Background variant={BackgroundVariant.Dots} gap={16} size={1} /><Controls /><MiniMap pannable zoomable /></ReactFlow></section>
      <aside className="properties panel"><div className="panel-title">Properties</div>{selectedNode ? <div className="property-form"><label>Name<input value={selectedNode.data.label} onChange={(event) => updateLabel(event.target.value)} /></label><label>Type<input value={selectedNode.data.kind} readOnly /></label>{isAxiInterconnect && <><button className="address-map-button" onClick={() => setAddressMapNodeId(selectedNode.id)}>Address Map</button><small className="address-map-summary">{selectedNode.data.addressMap?.entries.filter((entry) => entry.baseAddress && entry.size).length ?? 0} of {masterPorts.length} master ports configured</small></>}{(selectedNode.type === 'externalInput' || selectedNode.type === 'externalOutput') && <label>Width (bits)<input type="number" min="1" step="1" value={selectedNode.data.ports[0]?.width ?? 1} onChange={(event) => updateWidth(Number(event.target.value))} /></label>}<div className="property-section"><strong>Ports</strong>{selectedNode.data.ports.map((port) => <div className="port-property" key={port.id}><span>{port.name}</span><small>{port.type ?? (port.width !== undefined ? `${port.direction} · ${port.width}-bit` : port.direction)}</small></div>)}</div><button className="danger" onClick={deleteSelected}>Delete node</button></div> : <p className="empty-state">Select a node to edit its properties.</p>}</aside>
    </div>
    <footer className="statusbar"><span role="status">{status}</span><span>{nodes.length} nodes · {edges.length} connections</span></footer>
    {addressMapNode && <AddressMapEditor open nodeLabel={addressMapNode.data.label} masterPorts={addressMapNode.data.ports.filter((port) => port.type === 'axi.master')} value={addressMapNode.data.addressMap} onCancel={() => setAddressMapNodeId(null)} onApply={applyAddressMap} />}
  </main>
}
