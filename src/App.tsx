import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import BlockSettingsEditor from './BlockSettingsEditor'
import GeneratedPortsEditor from './GeneratedPortsEditor'
import OrthogonalEdge from './OrthogonalEdge'
import { mergeBlockSettings, validateBlockSettings } from './blockSettings'
import { adoptPortDefinitions, expandDefinition, generatedPorts, initialPortConfiguration, migratePortConfiguration, planPortChange, validateGenerate, validatePortIds } from './generatedPorts'
import type { AddressMap, BlockPort, BlockTemplate, DefineValue, DesignDocument, InterfacePortType, InterfaceDefinition, ParameterValue } from './types'

const STORAGE_KEY = 'block-design-studio-document-v1'
const THEME_STORAGE_KEY = 'block-design-studio-theme-v1'
type ThemePreference = 'system' | 'light' | 'dark'
const defaultInterfaces: InterfaceDefinition[] = [{ name: 'axi', label: 'AXI' }, { name: 'i2c', label: 'I2C' }]
const defaultTemplates: BlockTemplate[] = [
  { kind: 'Input', label: 'Input', ports: [{ id: 'data', name: 'data', direction: 'output', width: 32 }] },
  { kind: 'Output', label: 'Output', ports: [{ id: 'data', name: 'data', direction: 'input', width: 32 }] },
  { kind: 'Arithmetic', label: 'Adder', ports: [{ id: 'a', name: 'a', direction: 'input', width: 32 }, { id: 'b', name: 'b', direction: 'input', width: 32 }, { id: 'sum', name: 'sum', direction: 'output', width: 32 }] },
  { kind: 'CPU', label: 'CPU', ports: [{ id: 'clk', name: 'clk', direction: 'input', type: 'clock' }, { id: 'rst', name: 'rst', direction: 'input', type: 'reset' }, { id: 'imem', name: 'imem', direction: 'output', type: 'axi.master' }, { id: 'dmem', name: 'dmem', direction: 'output', type: 'axi.master' }] },
  { kind: 'AXI Interconnect', label: 'AXI Interconnect', ports: [{ id: 'clk', name: 'clk', direction: 'input', type: 'clock' }, { id: 's{i}', name: 's{i}', direction: 'output', type: 'axi.master', generate: { for: { index: 'i', count: 2, min: 1, max: 16 } } }, { id: 'm{i}', name: 'm{i}', direction: 'input', type: 'axi.slave', generate: { for: { index: 'i', count: 2, min: 1, max: 16 } } }] },
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
      const generate = validateGenerate(port.generate, port.id)
      if (port.type === 'clock' || port.type === 'reset') {
        if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Invalid direction on ${template.kind}.${port.id}`)
        return { id: port.id, name: port.name, direction: port.direction, type: port.type, ...(generate ? { generate } : {}) } as BlockPort
      }
      if (typeof port.type === 'string' && /\.(master|slave)$/.test(port.type)) {
        const interfaceName = port.type.replace(/\.(master|slave)$/, '')
        if (!names.has(interfaceName)) throw new Error(`Undefined interface ${interfaceName} on ${template.kind}.${port.id}`)
        return { id: port.id, name: port.name, direction: port.type.endsWith('.master') ? 'output' : 'input', type: port.type, ...(generate ? { generate } : {}) } as BlockPort
      }
      if (port.type !== undefined) throw new Error(`Invalid port type ${String(port.type)} on ${template.kind}.${port.id}`)
      if (port.direction !== 'input' && port.direction !== 'output') throw new Error(`Invalid direction on ${template.kind}.${port.id}`)
      if (typeof port.width !== 'number' || !Number.isInteger(port.width) || port.width < 1) throw new Error(`Invalid width on ${template.kind}.${port.id}`)
      return { id: port.id, name: port.name, direction: port.direction, width: port.width, ...(generate ? { generate } : {}) } as BlockPort
    })
    validatePortIds(ports)
    return { kind: template.kind, label: template.label, ports, ...validateBlockSettings(template, template.kind) }
  })
  return { interfaces, blocks }
}

export default function App() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  })
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
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
  const theme = themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference
  nodesRef.current = nodes
  edgesRef.current = edges

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const changeThemePreference = (preference: ThemePreference) => {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
    setThemePreference(preference)
  }

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
    const config = template.ports.some((port) => port.generate) ? initialPortConfiguration(template.ports) : undefined
    const ports = config ? generatedPorts(config.portDefinitions, config.config.ports.counts, config.config.ports.enabled) : template.ports.map((port) => ({ ...port }))
    const addressMap: AddressMap | undefined = template.kind === 'AXI Interconnect'
      ? { addressWidth: 32, groups: ports.filter((port) => port.type === 'axi.slave').map((port) => ({ slavePortId: port.id, entries: ports.filter((master) => master.type === 'axi.master').map((master) => ({ portId: master.id, baseAddress: null, size: null })) })) }
      : undefined
    const data = mergeBlockSettings({ label: template.label, kind: template.kind, ports, parameters: {}, ...config, ...(addressMap ? { addressMap } : {}) }, template)
    const newNode: BlockNode = { id, type: 'block', position: { x: 260 + nodesRef.current.length * 24, y: 120 + nodesRef.current.length * 24 }, data }
    replace([...nodesRef.current, newNode], edgesRef.current)
    record(before); setSelectedId(id); setStatus(`${template.label} added`)
  }

  const addExternal = (kind: 'input' | 'output' | 'clock' | 'reset' | InterfacePortType, definition?: InterfaceDefinition, side?: 'master' | 'slave', signalDirection: 'input' | 'output' = 'input') => {
    const isInterface = !!definition && !!side
    const isSignal = kind === 'clock' || kind === 'reset'
    const isAxi = kind === 'axi.master' || kind === 'axi.slave'
    const isI2c = kind === 'i2c.master' || kind === 'i2c.slave'
    const nodeType = isInterface ? (side === 'master' ? 'externalInterfaceMaster' : 'externalInterfaceSlave') : isAxi ? (kind === 'axi.master' ? 'externalAxiMaster' : 'externalAxiSlave') : isI2c ? (kind === 'i2c.master' ? 'externalI2cMaster' : 'externalI2cSlave') : isSignal ? (kind === 'clock' ? 'externalClock' : 'externalReset') : kind === 'input' ? 'externalInput' : 'externalOutput'
    const interfaceType = isInterface ? `${definition.name}.${side}` : kind
    const label = `external_${isInterface ? `${definition.name}_${side}` : isSignal && signalDirection === 'output' ? `${kind}_output` : kind.replace('.', '_')}`
    const port: BlockPort = isInterface || isAxi || isI2c
      ? { id: interfaceType.replace('.', '_'), name: label, direction: interfaceType.endsWith('.master') ? 'input' : 'output', type: interfaceType as InterfacePortType }
      : isSignal ? { id: kind, name: label, direction: signalDirection === 'input' ? 'output' : 'input', type: kind }
      : { id: `external_${kind}`, name: label, direction: kind === 'input' ? 'output' : 'input', width: 1 }
    const before = snapshot()
    const count = nodesRef.current.filter((node) => node.type === nodeType).length
    const id = `${nodeType}_${Date.now()}_${count}`
    const display = isInterface ? `${definition.label} ${side}` : isAxi || isI2c ? kind : isSignal ? `${kind[0].toUpperCase()}${kind.slice(1)} ${signalDirection === 'input' ? 'Input' : 'Output'}` : `External ${kind[0].toUpperCase()}${kind.slice(1)}`
    const newNode: BlockNode = { id, type: nodeType, position: { x: interfaceType.endsWith('.master') || (isSignal && signalDirection === 'output') ? 560 : 40, y: 140 + count * 64 }, data: { label, kind: `External ${display}`, ports: [port], parameters: {} } }
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
  const updateSettings = (update: (data: BlockNode['data']) => BlockNode['data']) => {
    if (!selectedId) return
    const before = snapshot()
    const next = nodesRef.current.map((node) => node.id === selectedId ? { ...node, data: update(node.data) } : node)
    replace(next, edgesRef.current)
    record(before)
  }
  const updateParameter = (name: string, value: ParameterValue) => updateSettings((data) => ({ ...data, parameters: { ...data.parameters, [name]: value } }))
  const updateDefine = (name: string, value: DefineValue) => updateSettings((data) => ({ ...data, defines: { ...data.defines, [name]: value } }))
  const updateGeneratedPorts = (counts: Record<string, number>, enabled: Record<string, boolean>, discarded: Set<string>) => {
    const node = nodesRef.current.find((item) => item.id === selectedId)
    if (!node?.data.portDefinitions) return
    const plan = planPortChange(node.id, node.data, edgesRef.current, counts, enabled, discarded)
    if (plan.removed.size) {
      const connections = plan.disconnected.map((edge) => `${edge.source}.${edge.sourceHandle} → ${edge.target}.${edge.targetHandle}`)
      const message = `Remove or disable ports: ${[...plan.removed].join(', ')}\n\nConnections to remove:\n${connections.length ? connections.join('\n') : 'None'}\n\nConfigured address map entries to remove:\n${plan.mappings.length ? plan.mappings.join('\n') : 'None'}\n\nContinue?`
      if (!window.confirm(message)) return
    }
    const before = snapshot()
    const nextNodes = nodesRef.current.map((item) => item.id === node.id ? { ...item, data: plan.data } : item)
    replace(nextNodes, plan.edges)
    record(before)
    setStatus('Port configuration updated')
  }
  const updatePortCount = (definition: BlockPort, count: number) => {
    const data = nodesRef.current.find((node) => node.id === selectedId)?.data
    const loop = definition.generate?.for
    if (!data || !loop || !Number.isInteger(count) || count < loop.min || count > loop.max) return
    const oldCount = data.config?.ports?.counts[definition.id] ?? loop.count
    const discarded = new Set(expandDefinition(definition, oldCount).slice(count).map((port) => port.id))
    const enabled = Object.fromEntries(Object.entries(data.config?.ports?.enabled ?? {}).filter(([id]) => !discarded.has(id)))
    updateGeneratedPorts({ ...data.config?.ports?.counts, [definition.id]: count }, enabled, discarded)
  }
  const updatePortEnabled = (port: BlockPort, enabled: boolean) => {
    const data = nodesRef.current.find((node) => node.id === selectedId)?.data
    if (!data) return
    updateGeneratedPorts(data.config?.ports?.counts ?? {}, { ...data.config?.ports?.enabled, [port.id]: enabled }, enabled ? new Set() : new Set([port.id]))
  }
  const applyAddressMap = (addressMap: AddressMap) => {
    if (!addressMapNodeId) return
    const before = snapshot()
    const next = nodesRef.current.map((node) => node.id === addressMapNodeId ? { ...node, data: { ...node.data, addressMap } } : node) as BlockNode[]
    replace(next, edgesRef.current); record(before); setAddressMapNodeId(null); setStatus('Address map saved')
  }

  const mergeDefinitions = (currentNodes: BlockNode[], definitions: BlockTemplate[]) => {
    const byKind = new Map(definitions.map((template) => [template.kind, template]))
    return currentNodes.map((node) => {
      const template = node.type === 'block' ? byKind.get(node.data.kind) : undefined
      if (!template) return node
      const data = adoptPortDefinitions(mergeBlockSettings(node.data, template), template.ports)
      return data === node.data ? node : { ...node, data }
    })
  }
  const migrationWarning = (currentNodes: BlockNode[], definitions: BlockTemplate[]) => {
    const kinds = new Set(definitions.filter((template) => template.ports.some((port) => port.generate)).map((template) => template.kind))
    const count = currentNodes.filter((node) => node.type === 'block' && !node.data.portDefinitions && kinds.has(node.data.kind)).length
    return count ? `; ${count} existing block(s) retain fixed ports because their ports do not match the definition` : ''
  }
  const loadDefinitions = async (file: File) => {
    try {
      const parsed = validateDefinitions(JSON.parse(await file.text()))
      const before = snapshot()
      const next = mergeDefinitions(nodesRef.current, parsed.blocks)
      if (next.some((node, index) => node !== nodesRef.current[index])) { replace(next, edgesRef.current); record(before) }
      setTemplates(parsed.blocks); setInterfaces(parsed.interfaces); setStatus(`${parsed.blocks.length} blocks and ${parsed.interfaces.length} interfaces loaded${migrationWarning(next, parsed.blocks)}`)
    }
    catch (error) { setStatus(error instanceof Error ? `Definition error: ${error.message}` : 'Could not load definitions') }
  }
  const openDesign = async (file: File) => {
    try { const document = JSON.parse(await file.text()) as DesignDocument; if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Unsupported design format'); const restored = (document.nodes as BlockNode[]).map((node) => ({ ...node, data: migratePortConfiguration(node.data) })); const next = mergeDefinitions(restored, templates); replace(next, document.edges as Edge[]); setDesignName(document.name || 'untitled'); setSelectedId(null); setStatus(`Design opened${migrationWarning(next, templates)}`) }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not open design') }
  }
  const saveDesign = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current })); setStatus('Saved in browser storage') }
  const exportDesign = () => { const blob = new Blob([JSON.stringify({ version: 1, name: designName, nodes: nodesRef.current, edges: edgesRef.current }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${designName || 'block-design'}.json`; anchor.click(); URL.revokeObjectURL(url) }

  const addressMapNode = nodes.find((node) => node.id === addressMapNodeId)
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">BD</div><strong>Block Design Studio</strong></div><input className="design-name" value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" /><div className="top-actions"><button onClick={undo} disabled={!pastRef.current.length} title="Undo">↶</button><button onClick={redo} disabled={!futureRef.current.length} title="Redo">↷</button><button onClick={() => definitionsFileRef.current?.click()}>Load definitions</button><input ref={definitionsFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadDefinitions(file); event.target.value = '' }} /><button onClick={saveDesign}>Save</button><button className="primary" onClick={exportDesign}>Export JSON</button><button onClick={() => designFileRef.current?.click()}>Open</button><input ref={designFileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openDesign(file); event.target.value = '' }} /><select className="theme-select" aria-label="Color theme" value={themePreference} onChange={(event) => { const preference = event.target.value; if (preference === 'system' || preference === 'light' || preference === 'dark') changeThemePreference(preference) }}><option value="system">Theme: System</option><option value="light">Theme: Light</option><option value="dark">Theme: Dark</option></select></div></header>
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
        <div className="palette"><div className="panel-title">External Ports</div><button className="library-item" onClick={() => addExternal('input')}><span className="library-icon">I</span><strong>External Input</strong></button><button className="library-item" onClick={() => addExternal('output')}><span className="library-icon">O</span><strong>External Output</strong></button><button className="library-item" onClick={() => addExternal('clock')}><span className="library-icon">C</span><strong>Clock Input</strong></button><button className="library-item" onClick={() => addExternal('clock', undefined, undefined, 'output')}><span className="library-icon">C</span><strong>Clock Output</strong></button><button className="library-item" onClick={() => addExternal('reset')}><span className="library-icon">R</span><strong>Reset Input</strong></button><button className="library-item" onClick={() => addExternal('reset', undefined, undefined, 'output')}><span className="library-icon">R</span><strong>Reset Output</strong></button>{interfaces.map((definition) => <div key={definition.name} className="interface-library-group"><div className="interface-library-label">{definition.label}</div><button className="library-item" onClick={() => addExternal('input', definition, 'master')}><span className="library-icon">M</span><strong>{definition.label} Master</strong></button><button className="library-item" onClick={() => addExternal('input', definition, 'slave')}><span className="library-icon">S</span><strong>{definition.label} Slave</strong></button></div>)}<div className="panel-title block-library-title">Block Library</div>{templates.map((template) => <button className="library-item" key={template.kind} onClick={() => addBlock(template)}><span className="library-icon">{template.kind.slice(0, 1)}</span><span><strong>{template.label}</strong><small>{template.kind}</small></span></button>)}</div>
      </aside>
      <section className="canvas-panel"><ReactFlow nodes={nodes} edges={displayedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={(changes: NodeChange<BlockNode>[]) => { const before = snapshot(); const next = applyNodeChanges(changes, nodesRef.current) as BlockNode[]; nodesRef.current = next; onNodesChangeBase(changes); if (changes.some((change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace')) record(before) }} onEdgesChange={(changes: EdgeChange<Edge>[]) => { const before = snapshot(); const next = applyEdgeChanges(changes, edgesRef.current); edgesRef.current = next; onEdgesChangeBase(changes); if (changes.some((change) => change.type === 'remove')) record(before) }} onConnect={onConnect} isValidConnection={isValidConnection} onSelectionChange={({ nodes: selected }: OnSelectionChangeParams) => setSelectedId(selected.length === 1 ? selected[0].id : null)} fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']}><Background variant={BackgroundVariant.Dots} gap={16} size={1} color={theme === 'dark' ? '#475569' : '#d7e0eb'} /><Controls /><MiniMap pannable zoomable bgColor={theme === 'dark' ? '#111827' : '#f7f9fc'} maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(15, 23, 42, 0.1)'} /></ReactFlow></section>
      <aside className="properties panel"><div className="panel-title">Properties</div>{selectedNode ? <div className="property-form"><label>Name<input value={selectedNode.data.label} onChange={(event) => updateLabel(event.target.value)} /></label><label>Type<input value={selectedNode.data.kind} readOnly /></label>{isAxiInterconnect && <><button className="address-map-button" onClick={() => setAddressMapNodeId(selectedNode.id)}>Address Map</button><small className="address-map-summary">{selectedNode.data.ports.filter((port) => port.type === 'axi.slave').length} slave groups · {masterPorts.length} master ports</small></>}{(selectedNode.type === 'externalInput' || selectedNode.type === 'externalOutput') && <label>Width (bits)<input type="number" min="1" step="1" value={selectedNode.data.ports[0]?.width ?? 1} onChange={(event) => updateWidth(Number(event.target.value))} /></label>}{selectedNode.type === 'block' && <><BlockSettingsEditor key={selectedNode.id} data={selectedNode.data} onParameterChange={updateParameter} onDefineChange={updateDefine} /><GeneratedPortsEditor key={selectedNode.id} data={selectedNode.data} onCountChange={updatePortCount} onEnabledChange={updatePortEnabled} /></>}<div className="property-section"><strong>Ports</strong>{selectedNode.data.ports.map((port) => <div className="port-property" key={port.id}><span>{port.name}</span><small>{port.type ?? (port.width !== undefined ? `${port.direction} · ${port.width}-bit` : port.direction)}</small></div>)}</div><button className="danger" onClick={deleteSelected}>Delete node</button></div> : <p className="empty-state">Select a node to edit its properties.</p>}</aside>
    </div>
    <footer className="statusbar"><span role="status">{status}</span><span>{nodes.length} nodes · {edges.length} connections</span></footer>
    {addressMapNode && <AddressMapEditor key={addressMapNode.id} node={addressMapNode} nodes={nodes} edges={edges} onCancel={() => setAddressMapNodeId(null)} onApply={applyAddressMap} />}
  </main>
}
