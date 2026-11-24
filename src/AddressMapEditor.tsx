import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Edge } from '@xyflow/react'
import type { BlockNode } from './BlockNode'
import type { AddressMapEntry, GroupedAddressMap } from './types'

interface AddressMapEditorProps {
  node: BlockNode
  nodes: BlockNode[]
  edges: Edge[]
  onCancel: () => void
  onApply: (value: GroupedAddressMap) => void
}

interface DraftEntry { portId: string; baseAddress: string; size: string }
interface DraftGroup { slavePortId: string; entries: DraftEntry[] }

function parseHex(value: string): bigint | null {
  const trimmed = value.trim()
  return /^0x[0-9a-f]+$/i.test(trimmed) ? BigInt(trimmed) : null
}

function validate(entries: DraftEntry[], addressWidth: 32 | 64) {
  const maxAddress = (1n << BigInt(addressWidth)) - 1n
  const ranges = entries.map((entry) => {
    const base = parseHex(entry.baseAddress)
    const size = parseHex(entry.size)
    if (!entry.baseAddress.trim() && !entry.size.trim()) return { ...entry, status: 'Unassigned', end: null }
    if (base === null || size === null) return { ...entry, status: 'Invalid hexadecimal value', end: null }
    if (size < 1n || base > maxAddress || size > maxAddress + 1n) return { ...entry, status: 'Value outside address range', end: null }
    if (base % size !== 0n) return { ...entry, status: 'Base address is not size-aligned', end: null }
    const end = base + size - 1n
    if (end > maxAddress) return { ...entry, status: 'Address range overflow', end: null }
    return { ...entry, status: 'Valid', end }
  })
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].end === null) continue
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[j].end === null) continue
      if (parseHex(ranges[i].baseAddress)! <= ranges[j].end! && parseHex(ranges[j].baseAddress)! <= ranges[i].end!) {
        ranges[i].status = 'Address range overlaps another master'
        ranges[j].status = 'Address range overlaps another master'
      }
    }
  }
  return ranges
}

export default function AddressMapEditor({ node, nodes, edges, onCancel, onApply }: AddressMapEditorProps) {
  const masterPorts = node.data.ports.filter((port) => port.type === 'axi.master')
  const slavePorts = node.data.ports.filter((port) => port.type === 'axi.slave')
  const value = node.data.addressMap
  const [addressWidth, setAddressWidth] = useState<32 | 64>(value?.addressWidth ?? 32)
  const [groups, setGroups] = useState<DraftGroup[]>(() => slavePorts.map((port) => {
    const existing = value && ('groups' in value
      ? value.groups.find((group) => group.slavePortId === port.id)?.entries
      : value.entries)
    return {
      slavePortId: port.id,
      entries: masterPorts.map((master) => {
        const entry = existing?.find((item) => item.portId === master.id)
        return { portId: master.id, baseAddress: entry?.baseAddress ?? '', size: entry?.size ?? '' }
      }),
    }
  }))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(slavePorts.map((port) => port.id)))

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  const connectedPort = (portId: string, side: 'source' | 'target') => {
    const edge = edges.find((item) => side === 'source'
      ? item.target === node.id && item.targetHandle === portId
      : item.source === node.id && item.sourceHandle === portId)
    if (!edge) return null
    const otherNode = nodes.find((item) => item.id === (side === 'source' ? edge.source : edge.target))
    if (!otherNode) return null
    const otherPort = otherNode.data.ports.find((item) => item.id === (side === 'source' ? edge.sourceHandle : edge.targetHandle))
    return [otherNode.data.label, otherPort?.name].filter(Boolean).join(' · ')
  }

  const validated = groups.map((group) => ({ ...group, ranges: validate(group.entries, addressWidth) }))
  const canApply = slavePorts.length > 0 && validated.every((group) => group.ranges.every((range) => range.status === 'Valid' || range.status === 'Unassigned'))
  const update = (slavePortId: string, masterPortId: string, field: 'baseAddress' | 'size', text: string) => {
    setGroups((current) => current.map((group) => group.slavePortId === slavePortId
      ? { ...group, entries: group.entries.map((entry) => entry.portId === masterPortId ? { ...entry, [field]: text } : entry) }
      : group))
  }
  const apply = () => {
    const savedGroups = groups.map((group) => {
      const previous = value && ('groups' in value
        ? value.groups.find((item) => item.slavePortId === group.slavePortId)?.entries
        : value.entries)
      const extraEntries = previous?.filter((entry) => !masterPorts.some((port) => port.id === entry.portId)) ?? []
      const entries: AddressMapEntry[] = group.entries.map(({ portId, baseAddress, size }) => ({
        portId, baseAddress: baseAddress.trim() || null, size: size.trim() || null,
      }))
      return { slavePortId: group.slavePortId, entries: [...entries, ...extraEntries] }
    })
    const extraGroups = value && 'groups' in value ? value.groups.filter((group) => !slavePorts.some((port) => port.id === group.slavePortId)) : []
    onApply({ addressWidth, groups: [...savedGroups, ...extraGroups] })
  }

  return createPortal(
    <div className="address-map-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div className="address-map-modal" role="dialog" aria-modal="true" aria-label="Address Map Editor">
        <div className="address-map-header">
          <h2>Address Map — {node.data.label}</h2>
          <div className="address-map-toolbar">
            <label htmlFor="address-width">Address width</label>
            <select id="address-width" value={addressWidth} onChange={(event) => setAddressWidth(Number(event.target.value) as 32 | 64)}>
              <option value={32}>32-bit</option><option value={64}>64-bit</option>
            </select>
          </div>
        </div>
        <div className="address-map-content">
          <div className="address-map-group-actions">
            <button type="button" onClick={() => setExpanded(new Set(slavePorts.map((port) => port.id)))}>Expand all</button>
            <button type="button" onClick={() => setExpanded(new Set())}>Collapse all</button>
          </div>
          {value && 'entries' in value && <p className="address-map-notice">Existing address ranges are copied to each slave group when applied.</p>}
          {slavePorts.length === 0 && <p className="address-map-notice">No AXI slave ports are available. Existing settings cannot be changed.</p>}
          {validated.map((group) => {
            const port = slavePorts.find((item) => item.id === group.slavePortId)!
            const errors = group.ranges.filter((range) => range.status !== 'Valid' && range.status !== 'Unassigned').length
            const configured = group.ranges.filter((range) => range.baseAddress.trim() && range.size.trim()).length
            const isExpanded = expanded.has(group.slavePortId)
            return <section className="address-map-group" key={group.slavePortId}>
              <button type="button" className="address-map-group-heading" aria-expanded={isExpanded} onClick={() => setExpanded((current) => {
                const next = new Set(current)
                if (next.has(group.slavePortId)) next.delete(group.slavePortId); else next.add(group.slavePortId)
                return next
              })}>
                <span>{isExpanded ? '▾' : '▸'} <strong>{port.name}</strong> ← {connectedPort(port.id, 'source') ?? 'Not connected'}</span>
                <span>{configured}/{masterPorts.length} configured{errors > 0 && <strong className="address-map-status error"> · {errors} errors</strong>}</span>
              </button>
              {isExpanded && <div className="address-map-table-wrap">
                <table className="address-map-table">
                  <thead><tr><th>Master Port</th><th>Connected Slave</th><th>Base Address</th><th>Size</th><th>End Address</th><th>Status</th></tr></thead>
                  <tbody>{group.ranges.map((range) => <tr key={range.portId}>
                    <td><strong>{masterPorts.find((item) => item.id === range.portId)?.name ?? range.portId}</strong></td>
                    <td>{connectedPort(range.portId, 'target') ?? <span className="address-map-status unassigned">Not connected</span>}</td>
                    <td><input aria-label={`${port.name} ${range.portId} base address`} value={range.baseAddress} placeholder="0x40000000" onChange={(event) => update(port.id, range.portId, 'baseAddress', event.target.value)} /></td>
                    <td><input aria-label={`${port.name} ${range.portId} size`} value={range.size} placeholder="0x10000" onChange={(event) => update(port.id, range.portId, 'size', event.target.value)} /></td>
                    <td className="end-address">{range.end === null ? '—' : `0x${range.end.toString(16).toUpperCase()}`}</td>
                    <td><span className={`address-map-status ${range.status === 'Valid' ? '' : range.status === 'Unassigned' ? 'unassigned' : 'error'}`}>{range.status}</span></td>
                  </tr>)}</tbody>
                </table>
              </div>}
            </section>
          })}
        </div>
        <div className="address-map-footer"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!canApply} onClick={apply}>Apply</button></div>
      </div>
    </div>,
    document.body,
  )
}
