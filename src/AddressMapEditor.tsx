import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AddressMap, AddressMapEntry, BlockPort } from './types'

interface AddressMapEditorProps {
  open: boolean
  nodeLabel: string
  masterPorts: BlockPort[]
  value?: AddressMap
  onCancel: () => void
  onApply: (value: AddressMap) => void
}

interface DraftEntry extends AddressMapEntry { baseAddress: string; size: string }

function parseHex(value: string): bigint | null {
  const trimmed = value.trim()
  if (!/^0x[0-9a-f]+$/i.test(trimmed)) return null
  try { return BigInt(trimmed) } catch { return null }
}

function formatHex(value: bigint): string {
  return `0x${value.toString(16).toUpperCase()}`
}

export default function AddressMapEditor({ open, nodeLabel, masterPorts, value, onCancel, onApply }: AddressMapEditorProps) {
  const [addressWidth, setAddressWidth] = useState<32 | 64>(value?.addressWidth ?? 32)
  const [entries, setEntries] = useState<DraftEntry[]>([])

  useEffect(() => {
    if (!open) return
    setAddressWidth(value?.addressWidth ?? 32)
    setEntries(masterPorts.map((port) => {
      const existing = value?.entries.find((entry) => entry.portId === port.id)
      return { portId: port.id, baseAddress: existing?.baseAddress ?? '', size: existing?.size ?? '' }
    }))
  }, [open, masterPorts, value])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onCancel])

  if (!open) return null

  const maxAddress = (1n << BigInt(addressWidth)) - 1n
  const ranges = entries.map((entry) => {
    const base = parseHex(entry.baseAddress)
    const size = parseHex(entry.size)
    if (!entry.baseAddress.trim() && !entry.size.trim()) return { ...entry, status: 'Unassigned', end: null }
    if (base === null || size === null) return { ...entry, status: 'Invalid hexadecimal value', end: null }
    if (base < 0n || size < 1n || base > maxAddress || size > maxAddress + 1n) return { ...entry, status: 'Value outside address range', end: null }
    if (base % size !== 0n) return { ...entry, status: 'Base address is not size-aligned', end: null }
    const end = base + size - 1n
    if (end > maxAddress) return { ...entry, status: 'Address range overflow', end: null }
    return { ...entry, status: 'Valid', end }
  })

  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].end === null) continue
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[j].end === null) continue
      const a = parseHex(ranges[i].baseAddress)!
      const b = parseHex(ranges[j].baseAddress)!
      const ae = ranges[i].end!
      const be = ranges[j].end!
      if (a <= be && b <= ae) {
        ranges[i].status = 'Address range overlaps another master'
        ranges[j].status = 'Address range overlaps another master'
      }
    }
  }

  const canApply = ranges.every((range) => range.status === 'Valid' || range.status === 'Unassigned')
  const update = (index: number, field: 'baseAddress' | 'size', text: string) => {
    setEntries((current) => current.map((entry, i) => i === index ? { ...entry, [field]: text } : entry))
  }
  const apply = () => {
    onApply({ addressWidth, entries: entries.map(({ portId, baseAddress, size }) => ({
      portId,
      baseAddress: baseAddress.trim() || null,
      size: size.trim() || null,
    })) })
  }

  return createPortal(
    <div className="address-map-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div className="address-map-modal" role="dialog" aria-modal="true" aria-label="Address Map Editor">
        <div className="address-map-header">
          <h2>Address Map — {nodeLabel}</h2>
          <div className="address-map-toolbar">
            <label htmlFor="address-width">Address width</label>
            <select id="address-width" value={addressWidth} onChange={(event) => setAddressWidth(Number(event.target.value) as 32 | 64)}>
              <option value={32}>32-bit</option>
              <option value={64}>64-bit</option>
            </select>
          </div>
        </div>
        <div className="address-map-table-wrap">
          <table className="address-map-table">
            <thead><tr><th>Master Port</th><th>Base Address</th><th>Size</th><th>End Address</th><th>Status</th></tr></thead>
            <tbody>{ranges.map((range, index) => <tr key={range.portId}>
              <td><strong>{range.portId}</strong></td>
              <td><input aria-label={`${range.portId} base address`} value={entries[index].baseAddress} placeholder="0x40000000" onChange={(event) => update(index, 'baseAddress', event.target.value)} /></td>
              <td><input aria-label={`${range.portId} size`} value={entries[index].size} placeholder="0x10000" onChange={(event) => update(index, 'size', event.target.value)} /></td>
              <td className="end-address">{range.end === null ? '—' : formatHex(range.end)}</td>
              <td><span className={`address-map-status ${range.status === 'Valid' ? '' : range.status === 'Unassigned' ? 'unassigned' : 'error'}`}>{range.status}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="address-map-footer"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!canApply} onClick={apply}>Apply</button></div>
      </div>
    </div>,
    document.body,
  )
}
